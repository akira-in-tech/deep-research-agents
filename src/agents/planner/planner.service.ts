import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import {
  OutlineSection,
  SearchQuery,
  ResearchBudget,
} from '../../core/research-state.interface';
import { finiteNumber, isRecord, nonEmptyStrings } from '../../core/validation';

// The shape Planner produces and writes back into the shared state.
export interface PlanResult {
  objective: string;
  subQuestions: string[];
  outline: OutlineSection[];
  searchPlan: SearchQuery[];
  budget: ResearchBudget;
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(private readonly llm: LlmService) {}
  // The Planner's role + the exact JSON shape we want back.
  private readonly systemPrompt = `You are ChiefArchitect, a research planner. You receive a single user query and must break it into an executable research plan.

Output ONLY a JSON object. No markdown, no explanation. Use this exact shape:
{
  "objective": "one-sentence research goal",
  "subQuestions": ["the core original question", "derived sub-question 1", "derived sub-question 2"],
  "outline": [
    {
      "id": "sec_1",
      "title": "section title",
      "description": "what this section covers",
      "sectionType": "mixed",
      "priority": 1,
      "searchQueries": ["natural-language search term 1", "search term 2"],
      "status": "pending"
    }
  ],
  "searchPlan": [
    {
      "sectionId": "sec_1",
      "query": "a concrete search query",
      "sourcePreference": "hybrid",
      "reason": "why this query helps"
    }
  ],
  "budget": {
    "maxRounds": 2,
    "maxSources": 12,
    "maxTokens": 12000,
    "maxSeconds": 45
  }
}

Rules:
- subQuestions must contain the original question plus 2-3 derived sub-questions.
- Each outline section must carry its own searchQueries (natural language, not keyword soup).
- searchPlan should hold 3-6 concrete queries derived from the outline.
- sourcePreference is one of: "web", "local", "hybrid".
- Keep the budget reasonable for a focused research task.`;
  /**
   * Break a user query into a structured research plan.
   * Calls Claude, safely parses the JSON, and falls back to a
   * minimal plan if parsing fails — so the pipeline never breaks.
   */
  async plan(query: string, memoryContext = ''): Promise<PlanResult> {
    const prompt = `User query: ${query}
${memoryContext ? `Prior session context: ${memoryContext}\n` : ''}
First decompose the problem, then output the planning JSON.`;

    const raw = await this.llm.chat(this.systemPrompt, prompt);

    // Fallback: a minimal but valid plan built straight from the query.
    const fallback: PlanResult = {
      objective: query,
      subQuestions: [query],
      outline: [
        {
          id: 'sec_1',
          title: 'Default Section',
          description: 'Auto-generated fallback section',
          sectionType: 'mixed',
          priority: 1,
          searchQueries: [query],
          status: 'pending',
        },
      ],
      searchPlan: [
        {
          sectionId: 'sec_1',
          query: query,
          sourcePreference: 'hybrid',
          reason: 'fallback query',
        },
      ],
      budget: {
        maxRounds: 2,
        maxSources: 12,
        maxTokens: 12000,
        maxSeconds: 45,
      },
    };

    const parsed = this.llm.extractJson<unknown>(raw, fallback);
    const record = isRecord(parsed) ? parsed : fallback;

    const subQuestions = nonEmptyStrings(record.subQuestions, 4);
    const rawOutline = Array.isArray(record.outline) ? record.outline : [];
    const outline = rawOutline
      .filter(isRecord)
      .map((section, index): OutlineSection => ({
        id:
          typeof section.id === 'string' && section.id.trim()
            ? section.id.trim()
            : `sec_${index + 1}`,
        title:
          typeof section.title === 'string' && section.title.trim()
            ? section.title.trim()
            : `Section ${index + 1}`,
        description:
          typeof section.description === 'string'
            ? section.description.trim()
            : '',
        sectionType:
          typeof section.sectionType === 'string'
            ? section.sectionType
            : 'mixed',
        priority: finiteNumber(section.priority, index + 1),
        searchQueries: nonEmptyStrings(section.searchQueries, 6),
        status: typeof section.status === 'string' ? section.status : 'pending',
      }))
      .slice(0, 8);

    const rawSearchPlan = Array.isArray(record.searchPlan)
      ? record.searchPlan
      : [];
    const searchPlan = rawSearchPlan
      .filter(isRecord)
      .map((item): SearchQuery | undefined => {
        const query = typeof item.query === 'string' ? item.query.trim() : '';
        if (!query) {
          return undefined;
        }
        const preference =
          typeof item.sourcePreference === 'string'
            ? item.sourcePreference.toLowerCase()
            : 'hybrid';
        return {
          sectionId:
            typeof item.sectionId === 'string' ? item.sectionId : 'sec_1',
          query,
          sourcePreference: ['web', 'local', 'hybrid'].includes(preference)
            ? preference
            : 'hybrid',
          reason: typeof item.reason === 'string' ? item.reason : '',
        };
      })
      .filter((item): item is SearchQuery => item !== undefined)
      .slice(0, 6);

    const rawBudget = isRecord(record.budget) ? record.budget : {};
    const result: PlanResult = {
      objective:
        typeof record.objective === 'string' && record.objective.trim()
          ? record.objective.trim()
          : fallback.objective,
      subQuestions:
        subQuestions.length > 0 ? subQuestions : fallback.subQuestions,
      outline: outline.length > 0 ? outline : fallback.outline,
      searchPlan: searchPlan.length > 0 ? searchPlan : fallback.searchPlan,
      budget: {
        maxRounds: finiteNumber(rawBudget.maxRounds, fallback.budget.maxRounds),
        maxSources: finiteNumber(
          rawBudget.maxSources,
          fallback.budget.maxSources,
        ),
        maxTokens: finiteNumber(rawBudget.maxTokens, fallback.budget.maxTokens),
        maxSeconds: finiteNumber(
          rawBudget.maxSeconds,
          fallback.budget.maxSeconds,
        ),
      },
    };

    this.logger.log(
      `Plan ready: ${result.subQuestions.length} sub-questions, ${result.searchPlan.length} search queries`,
    );
    return result;
  }
}

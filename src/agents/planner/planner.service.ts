import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import {
  OutlineSection,
  SearchQuery,
  ResearchBudget,
} from '../../core/research-state.interface';

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
  async plan(query: string): Promise<PlanResult> {
    const prompt = `User query: ${query}
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

    const result = this.llm.extractJson<PlanResult>(raw, fallback);

    this.logger.log(
      `Plan ready: ${result.subQuestions.length} sub-questions, ${result.searchPlan.length} search queries`,
    );
    return result;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import { SearchQuery } from '../../core/research-state.interface';
import { isRecord } from '../../core/validation';

@Injectable()
export class ReflectService {
  private readonly logger = new Logger(ReflectService.name);

  constructor(private readonly llm: LlmService) {}

  // Reflect's role: turn information gaps into NEW, non-duplicate queries.
  private readonly systemPrompt = `You are ResearchPlanner, responsible for generating a supplementary search plan based on the Analyst's feedback.

You receive:
1. The original question
2. The sub-questions
3. The search queries already executed
4. The information gaps the Analyst identified (missingGaps)

Your tasks:
1. Analyze each gap and decide what new information is needed.
2. Generate supplementary queries that are DIFFERENT from the queries already executed. Try new angles, more specific terms, or finer-grained sub-queries.
3. Generate 1-2 queries per gap.

Output ONLY a JSON object, no markdown, in this exact shape:
{
  "reflectionSummary": "brief summary of the supplementary strategy",
  "supplementaryQueries": [
    {
      "sectionId": "gap_1",
      "query": "a new, more targeted search term",
      "sourcePreference": "web" | "local" | "hybrid",
      "reason": "why this query fills the gap"
    }
  ]
}

Constraints:
- New queries MUST be different from the already-executed ones.
- Each query must directly target a specific gap.`;

  /**
   * Generate supplementary search queries to fill the gaps the
   * Analyst found. Drives the "insufficient evidence -> re-search" loop.
   */
  async reflect(
    query: string,
    subQuestions: string[],
    executedQueries: string[],
    missingGaps: string[],
  ): Promise<SearchQuery[]> {
    const prompt = `Original question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}
Already-executed queries: ${JSON.stringify(executedQueries)}
Information gaps to fill: ${JSON.stringify(missingGaps)}

Generate the supplementary search plan. Output the JSON now.`;

    // Fallback: re-search the gaps directly if parsing fails.
    const fallback = {
      reflectionSummary: 'Default supplementary plan',
      supplementaryQueries: missingGaps.slice(0, 2).map((gap, i) => ({
        sectionId: `gap_${i + 1}`,
        query: gap,
        sourcePreference: 'hybrid',
        reason: 'fallback query targeting the gap',
      })),
    };

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<unknown>(raw, fallback);
    const record = isRecord(parsed) ? parsed : fallback;
    const executed = new Set(
      executedQueries.map((item) => item.trim().toLowerCase()),
    );
    const seen = new Set<string>();
    const rawQueries = Array.isArray(record.supplementaryQueries)
      ? record.supplementaryQueries
      : [];
    const supplementaryQueries = rawQueries
      .filter(isRecord)
      .map((item, index): SearchQuery | undefined => {
        const queryText =
          typeof item.query === 'string' ? item.query.trim() : '';
        const dedupeKey = queryText.toLowerCase();
        if (!queryText || executed.has(dedupeKey) || seen.has(dedupeKey)) {
          return undefined;
        }
        seen.add(dedupeKey);

        const preference =
          typeof item.sourcePreference === 'string'
            ? item.sourcePreference.toLowerCase()
            : 'hybrid';
        return {
          sectionId:
            typeof item.sectionId === 'string'
              ? item.sectionId
              : `gap_${index + 1}`,
          query: queryText,
          sourcePreference: ['web', 'local', 'hybrid'].includes(preference)
            ? preference
            : 'hybrid',
          reason: typeof item.reason === 'string' ? item.reason : '',
        };
      })
      .filter((item): item is SearchQuery => item !== undefined)
      .slice(0, 6);

    this.logger.log(
      `Reflect generated ${supplementaryQueries.length} supplementary queries`,
    );
    return supplementaryQueries;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import { SearchQuery } from '../../core/research-state.interface';

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
    const parsed = this.llm.extractJson<{
      reflectionSummary: string;
      supplementaryQueries: SearchQuery[];
    }>(raw, fallback);

    this.logger.log(
      `Reflect generated ${parsed.supplementaryQueries.length} supplementary queries`,
    );
    return parsed.supplementaryQueries;
  }
}
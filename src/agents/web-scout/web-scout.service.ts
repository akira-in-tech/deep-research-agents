import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { tavily, TavilyClient } from '@tavily/core';
import { LlmService } from '../../llm/llm.service';
import { Evidence } from '../../core/research-state.interface';

@Injectable()
export class WebScoutService implements OnModuleInit {
  private readonly logger = new Logger(WebScoutService.name);
  private tavilyClient!: TavilyClient;

  constructor(private readonly llm: LlmService) {}

  // Set up the Tavily client once at startup.
  onModuleInit() {
    this.tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });
  }
  /**
   * Run the search queries against Tavily and collect raw results.
   * Each result is tagged with a source_id following the pattern
   * WEB{iteration}_{queryIndex}-{resultIndex}, matching the reference design.
   */
  private async searchWeb(
    queries: string[],
    iteration: number,
  ): Promise<Evidence[]> {
    const rawEvidence: Evidence[] = [];

    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      const query = queries[queryIndex];

      try {
        // Ask Tavily for up to 4 results per query to keep token usage low.
        const response = await this.tavilyClient.search(query, {
          maxResults: 4,
        });

        response.results.forEach((result, resultIndex) => {
          rawEvidence.push({
            sourceId: `WEB${iteration}_${queryIndex + 1}-${resultIndex + 1}`,
            sourceType: 'web',
            title: result.title,
            url: result.url,
            snippet: result.content,
            supportsQuestions: [],
          });
        });

        this.logger.log(
          `Query "${query}" returned ${response.results.length} results`,
        );
      } catch (error) {
        // One failed query shouldn't kill the whole search.
        this.logger.warn(`Tavily search failed for "${query}": ${error}`);
      }
    }

    return rawEvidence;
  }
  // The WebScout's role: filter raw results and keep only relevant evidence.
  private readonly systemPrompt = `You are WebScout, responsible for web evidence collection and relevance filtering.

You receive:
1. The user's original question
2. A list of sub-questions
3. Raw web evidence (each with sourceId, title, url, snippet)

Your tasks:
1. Judge relevance: keep evidence that contains useful info related to the question or any sub-question. Drop obvious ads or irrelevant results.
2. Link sub-questions: for each kept evidence, list which sub-questions it supports.

Output ONLY a JSON object, no markdown, in this exact shape:
{
  "summary": "2-3 sentence summary of what was collected",
  "evidence": [
    {
      "sourceId": "WEB1_1-1",
      "supportsQuestions": ["sub-question text it supports"]
    }
  ],
  "rejectedSourceIds": ["WEB1_2-1"]
}

Constraints:
- Only use sourceIds that appear in the input. Never invent new ones.
- When unsure but the result mentions the topic, keep it.`;

  /**
   * Main entry point. Searches the web, then asks Claude to filter
   * the raw results and tag each with the sub-questions it supports.
   */
  async scout(
    query: string,
    subQuestions: string[],
    searchQueries: string[],
    iteration: number,
  ): Promise<Evidence[]> {
    // Step 1: get raw results from Tavily.
    const rawEvidence = await this.searchWeb(searchQueries, iteration);

    if (rawEvidence.length === 0) {
      this.logger.warn('No web evidence found, skipping.');
      return [];
    }

    // Step 2: ask Claude to filter and tag the raw evidence.
    const prompt = `Original question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}
Raw web evidence:
${JSON.stringify(rawEvidence.map((e) => ({ sourceId: e.sourceId, title: e.title, snippet: e.snippet })))}

Filter and tag the evidence. Output the JSON now.`;

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<{
      summary: string;
      evidence: { sourceId: string; supportsQuestions: string[] }[];
      rejectedSourceIds: string[];
    }>(raw, {
      summary: 'Using unfiltered web results because relevance parsing failed.',
      evidence: rawEvidence.map((evidence) => ({
        sourceId: evidence.sourceId,
        supportsQuestions: subQuestions,
      })),
      rejectedSourceIds: [],
    });

    // Step 3: merge Claude's tags back onto the raw evidence we trust.
    const keptIds = new Set(parsed.evidence.map((e) => e.sourceId));
    const result = rawEvidence
      .filter((e) => keptIds.has(e.sourceId))
      .map((e) => {
        const tag = parsed.evidence.find((t) => t.sourceId === e.sourceId);
        return { ...e, supportsQuestions: tag?.supportsQuestions ?? [] };
      });

    this.logger.log(
      `WebScout kept ${result.length}/${rawEvidence.length} evidence items`,
    );
    return result;
  }
}

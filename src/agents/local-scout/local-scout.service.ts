import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { VoyageAIClient } from 'voyageai';
import { LlmService } from '../../llm/llm.service';
import { Evidence } from '../../core/research-state.interface';

const COLLECTION_NAME = 'knowledge_base';

@Injectable()
export class LocalScoutService {
  private readonly logger = new Logger(LocalScoutService.name);
  private readonly milvus: MilvusClient;
  private readonly voyage: VoyageAIClient;

  constructor(
    private readonly llm: LlmService,
    config: ConfigService,
  ) {
    this.milvus = new MilvusClient({
      address: config.get<string>('MILVUS_ADDRESS', 'localhost:19530'),
      __SKIP_CONNECT__: true,
    });
    this.voyage = new VoyageAIClient({
      apiKey: config.get<string>('VOYAGE_API_KEY'),
    });
  }
  /**
   * Embed each query with Voyage, then run a vector similarity search
   * against Milvus. Returns raw evidence tagged with source ids
   * following the pattern LOC{iteration}_{queryIndex}-{resultIndex}.
   */
  private async searchLocal(
    queries: string[],
    iteration: number,
  ): Promise<Evidence[]> {
    const rawEvidence: Evidence[] = [];

    for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
      const query = queries[queryIndex];

      try {
        // Step 1: turn the query text into a vector (inputType: 'query').
        const embedRes = await this.voyage.embed({
          input: [query],
          model: 'voyage-3',
          inputType: 'query',
        });
        const queryVector = embedRes.data![0].embedding!;

        // Step 2: vector similarity search in Milvus, top 3 matches.
        const searchRes = await this.milvus.search({
          collection_name: COLLECTION_NAME,
          data: [queryVector],
          limit: 3,
          output_fields: ['doc_id', 'text'],
        });

        // Step 3: wrap each hit as an Evidence item.
        searchRes.results.forEach((hit, resultIndex) => {
          rawEvidence.push({
            sourceId: `LOC${iteration}_${queryIndex + 1}-${resultIndex + 1}`,
            sourceType: 'local',
            title: hit.doc_id as string,
            docId: hit.doc_id as string,
            snippet: hit.text as string,
            supportsQuestions: [],
          });
        });

        this.logger.log(
          `Query "${query}" matched ${searchRes.results.length} local docs`,
        );
      } catch (error) {
        this.logger.warn(`Local search failed for "${query}": ${error}`);
      }
    }

    return rawEvidence;
  }
  // The LocalScout's role: filter local knowledge-base results.
  private readonly systemPrompt = `You are LocalScout, responsible for filtering internal knowledge-base evidence.

You receive:
1. The user's original question
2. A list of sub-questions
3. Raw local evidence (each with sourceId, docId, snippet)

Your tasks:
1. Judge relevance: keep evidence relevant to the question or any sub-question. Internal knowledge-base content is high-trust, but still judge relevance. Drop clearly irrelevant items.
2. Link sub-questions: for each kept evidence, list which sub-questions it supports.

Output ONLY a JSON object, no markdown, in this exact shape:
{
  "summary": "2-3 sentence summary of what was collected",
  "evidence": [
    {
      "sourceId": "LOC1_1-1",
      "supportsQuestions": ["sub-question text it supports"]
    }
  ],
  "rejectedSourceIds": ["LOC1_2-1"]
}

Constraints:
- Only use sourceIds that appear in the input. Never invent new ones.
- Internal knowledge-base evidence is high-trust; keep it unless clearly irrelevant.`;

  /**
   * Main entry point. Searches the local knowledge base, then asks
   * Claude to filter and tag the raw results.
   */
  async scout(
    query: string,
    subQuestions: string[],
    searchQueries: string[],
    iteration: number,
  ): Promise<Evidence[]> {
    // Step 1: vector search against the local knowledge base.
    const rawEvidence = await this.searchLocal(searchQueries, iteration);

    if (rawEvidence.length === 0) {
      this.logger.warn('No local evidence found, skipping.');
      return [];
    }

    // Step 2: ask Claude to filter and tag the raw evidence.
    const prompt = `Original question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}
Raw local evidence:
${JSON.stringify(rawEvidence.map((e) => ({ sourceId: e.sourceId, docId: e.docId, snippet: e.snippet })))}

Filter and tag the evidence. Output the JSON now.`;

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<{
      summary: string;
      evidence: { sourceId: string; supportsQuestions: string[] }[];
      rejectedSourceIds: string[];
    }>(raw, {
      summary:
        'Using unfiltered local results because relevance parsing failed.',
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
      `LocalScout kept ${result.length}/${rawEvidence.length} evidence items`,
    );
    return result;
  }
}

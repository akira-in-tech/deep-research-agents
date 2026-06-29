import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node';
import { VoyageAIClient } from 'voyageai';

export interface SemanticMemoryMatch {
  id: string;
  userId: string;
  text: string;
  score: number;
}

@Injectable()
export class SemanticMemoryService {
  private readonly logger = new Logger(SemanticMemoryService.name);
  private readonly collectionName: string;
  private readonly embeddingDimension = 1_024;
  private readonly minimumContextScore = 0.55;
  private readonly milvus: MilvusClient;
  private readonly voyage: VoyageAIClient;
  private initialization?: Promise<void>;

  constructor(config: ConfigService) {
    this.collectionName = config.get<string>(
      'SEMANTIC_MEMORY_COLLECTION',
      'semantic_memory',
    );
    this.milvus = new MilvusClient({
      address: config.get<string>('MILVUS_ADDRESS', 'localhost:19530'),
      __SKIP_CONNECT__: true,
    });
    this.voyage = new VoyageAIClient({
      apiKey: config.get<string>('VOYAGE_API_KEY'),
    });
  }

  private async initializeCollection(): Promise<void> {
    const existing = await this.milvus.hasCollection({
      collection_name: this.collectionName,
    });

    if (!existing.value) {
      await this.milvus.createCollection({
        collection_name: this.collectionName,
        fields: [
          {
            name: 'memory_id',
            data_type: DataType.VarChar,
            max_length: 64,
            is_primary_key: true,
          },
          {
            name: 'user_id',
            data_type: DataType.VarChar,
            max_length: 128,
            is_partition_key: true,
          },
          {
            name: 'text',
            data_type: DataType.VarChar,
            max_length: 4_096,
          },
          {
            name: 'vector',
            data_type: DataType.FloatVector,
            dim: this.embeddingDimension,
          },
        ],
        num_partitions: 16,
      });
      await this.milvus.createIndex({
        collection_name: this.collectionName,
        field_name: 'vector',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });
      this.logger.log(`Created Milvus collection ${this.collectionName}`);
    }

    await this.milvus.loadCollection({
      collection_name: this.collectionName,
    });
  }

  private async ensureCollection(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeCollection().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  private async embed(
    text: string,
    inputType: 'document' | 'query',
  ): Promise<number[]> {
    const result = await this.voyage.embed({
      input: [text],
      model: 'voyage-3',
      inputType,
    });
    const vector = result.data?.[0]?.embedding;
    if (!vector || vector.length !== this.embeddingDimension) {
      throw new Error('Voyage returned an invalid semantic-memory embedding');
    }
    return vector;
  }

  async store(memoryId: string, userId: string, text: string): Promise<void> {
    await this.ensureCollection();
    const vector = await this.embed(text, 'document');
    await this.milvus.upsert({
      collection_name: this.collectionName,
      data: [
        {
          memory_id: memoryId,
          user_id: userId,
          text,
          vector,
        },
      ],
    });
    await this.milvus.flush({ collection_names: [this.collectionName] });
  }

  async search(
    userId: string,
    query: string,
    limit = 5,
  ): Promise<SemanticMemoryMatch[]> {
    try {
      await this.ensureCollection();
      const vector = await this.embed(query, 'query');
      const safeUserId = userId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const result = await this.milvus.search({
        collection_name: this.collectionName,
        data: [vector],
        filter: `user_id == "${safeUserId}"`,
        limit: Math.min(20, Math.max(1, Math.floor(limit))),
        output_fields: ['user_id', 'text'],
        metric_type: 'COSINE',
      });

      return result.results
        .map((hit): SemanticMemoryMatch | undefined => {
          const text = typeof hit.text === 'string' ? hit.text : '';
          const resultUserId =
            typeof hit.user_id === 'string' ? hit.user_id : userId;
          if (!text) {
            return undefined;
          }
          return {
            id: String(hit.id),
            userId: resultUserId,
            text,
            score: hit.score,
          };
        })
        .filter((match): match is SemanticMemoryMatch => match !== undefined);
    } catch (error) {
      this.logger.warn(`Semantic memory search unavailable: ${String(error)}`);
      return [];
    }
  }

  async getContext(userId?: string, query?: string): Promise<string> {
    if (!userId || !query) {
      return '';
    }

    const matches = (await this.search(userId, query)).filter(
      (match) => match.score >= this.minimumContextScore,
    );
    if (matches.length === 0) {
      return '';
    }

    return `Semantically relevant user memories:\n${matches
      .map((match) => `- ${match.text}`)
      .join('\n')}`;
  }
}

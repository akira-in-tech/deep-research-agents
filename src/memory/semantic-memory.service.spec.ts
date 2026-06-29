import { ConfigService } from '@nestjs/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { VoyageAIClient } from 'voyageai';
import { SemanticMemoryService } from './semantic-memory.service';

jest.mock('@zilliz/milvus2-sdk-node', () => ({
  DataType: { VarChar: 21, FloatVector: 101 },
  MilvusClient: jest.fn(),
}));

jest.mock('voyageai', () => ({
  VoyageAIClient: jest.fn(),
}));

describe('SemanticMemoryService', () => {
  const vector = Array.from({ length: 1_024 }, () => 0.01);
  let milvus: {
    hasCollection: jest.Mock;
    createCollection: jest.Mock;
    createIndex: jest.Mock;
    loadCollection: jest.Mock;
    upsert: jest.Mock;
    flush: jest.Mock;
    search: jest.Mock;
  };
  let voyage: { embed: jest.Mock };
  let service: SemanticMemoryService;

  beforeEach(() => {
    milvus = {
      hasCollection: jest.fn(),
      createCollection: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn().mockResolvedValue({}),
      loadCollection: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      flush: jest.fn().mockResolvedValue({}),
      search: jest.fn(),
    };
    voyage = {
      embed: jest.fn().mockResolvedValue({ data: [{ embedding: vector }] }),
    };

    jest.mocked(MilvusClient).mockImplementation(() => milvus as never);
    jest.mocked(VoyageAIClient).mockImplementation(() => voyage as never);

    const config = {
      get: jest.fn((_key: string, fallback?: string) => fallback),
    } as unknown as ConfigService;
    service = new SemanticMemoryService(config);
  });

  it('creates the collection and upserts memory by PostgreSQL id', async () => {
    milvus.hasCollection.mockResolvedValue({ value: false });

    await service.store('memory-1', 'user-1', 'Prefers concise reports');

    expect(milvus.createCollection).toHaveBeenCalled();
    expect(milvus.createIndex).toHaveBeenCalled();
    expect(milvus.upsert).toHaveBeenCalledWith({
      collection_name: 'semantic_memory',
      data: [
        {
          memory_id: 'memory-1',
          user_id: 'user-1',
          text: 'Prefers concise reports',
          vector,
        },
      ],
    });
  });

  it('searches within one user partition', async () => {
    milvus.hasCollection.mockResolvedValue({ value: true });
    milvus.search.mockResolvedValue({
      results: [
        {
          id: 'memory-1',
          user_id: 'user-1',
          text: 'Prefers concise reports',
          score: 0.91,
        },
      ],
    });

    const results = await service.search('user-1', 'report style');

    expect(results).toEqual([
      {
        id: 'memory-1',
        userId: 'user-1',
        text: 'Prefers concise reports',
        score: 0.91,
      },
    ]);
    expect(milvus.search).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'user_id == "user-1"' }),
    );
  });

  it('returns no semantic context when Milvus is unavailable', async () => {
    milvus.hasCollection.mockRejectedValue(new Error('Milvus unavailable'));

    await expect(service.search('user-1', 'report style')).resolves.toEqual([]);
  });
});

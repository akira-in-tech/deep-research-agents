/* eslint-disable @typescript-eslint/unbound-method */
import { LongTermMemory } from './entities/long-term-memory.entity';
import { LongTermMemoryService } from './long-term-memory.service';
import { MemoryManagerService } from './memory-manager.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { ShortTermMemoryService } from './short-term-memory.service';

describe('MemoryManagerService', () => {
  let shortTerm: jest.Mocked<ShortTermMemoryService>;
  let longTerm: jest.Mocked<LongTermMemoryService>;
  let semantic: jest.Mocked<SemanticMemoryService>;
  let service: MemoryManagerService;

  beforeEach(() => {
    shortTerm = {
      getContext: jest.fn(),
      saveContext: jest.fn(),
    } as unknown as jest.Mocked<ShortTermMemoryService>;
    longTerm = {
      getContext: jest.fn(),
      remember: jest.fn(),
    } as unknown as jest.Mocked<LongTermMemoryService>;
    semantic = {
      getContext: jest.fn(),
      store: jest.fn(),
      search: jest.fn(),
    } as unknown as jest.Mocked<SemanticMemoryService>;

    service = new MemoryManagerService(shortTerm, longTerm, semantic);
  });

  it('combines long-term, semantic, and session context', async () => {
    shortTerm.getContext.mockResolvedValue('Session context');
    longTerm.getContext.mockResolvedValue('Known user facts');
    semantic.getContext.mockResolvedValue('Relevant semantic memory');

    const result = await service.getContext(
      'session-1',
      'user-1',
      'current query',
    );

    expect(result).toBe(
      'Known user facts\n\nRelevant semantic memory\n\nSession context',
    );
    expect(semantic.getContext).toHaveBeenCalledWith('user-1', 'current query');
  });

  it('stores a PostgreSQL fact and indexes it semantically', async () => {
    const memory = {
      id: 'memory-1',
      userId: 'user-1',
      fact: 'Prefers concise reports',
    } as LongTermMemory;
    longTerm.remember.mockResolvedValue(memory);
    semantic.store.mockResolvedValue();

    const result = await service.rememberFact('user-1', memory.fact);

    expect(result).toEqual({ memory, semanticIndexed: true });
    expect(semantic.store).toHaveBeenCalledWith(
      memory.id,
      memory.userId,
      memory.fact,
    );
  });

  it('keeps PostgreSQL memory when semantic indexing is unavailable', async () => {
    const memory = {
      id: 'memory-1',
      userId: 'user-1',
      fact: 'Prefers concise reports',
    } as LongTermMemory;
    longTerm.remember.mockResolvedValue(memory);
    semantic.store.mockRejectedValue(new Error('Milvus unavailable'));

    await expect(service.rememberFact('user-1', memory.fact)).resolves.toEqual({
      memory,
      semanticIndexed: false,
    });
  });
});

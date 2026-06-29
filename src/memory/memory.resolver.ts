import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { LongTermMemoryService } from './long-term-memory.service';
import { LongTermMemoryRecord, SemanticMemoryResult } from './memory.model';
import { MemoryManagerService } from './memory-manager.service';

@Resolver(() => LongTermMemoryRecord)
export class MemoryResolver {
  constructor(
    private readonly longTermMemory: LongTermMemoryService,
    private readonly memoryManager: MemoryManagerService,
  ) {}

  @Mutation(() => LongTermMemoryRecord)
  async rememberFact(
    @Args('userId') userId: string,
    @Args('fact') fact: string,
  ): Promise<LongTermMemoryRecord> {
    const result = await this.memoryManager.rememberFact(userId, fact);
    return {
      ...result.memory,
      semanticIndexed: result.semanticIndexed,
    };
  }

  @Query(() => [LongTermMemoryRecord])
  longTermMemories(
    @Args('userId') userId: string,
  ): Promise<LongTermMemoryRecord[]> {
    return this.longTermMemory.findByUser(userId);
  }

  @Query(() => [SemanticMemoryResult])
  semanticMemories(
    @Args('userId') userId: string,
    @Args('query') query: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<SemanticMemoryResult[]> {
    return this.memoryManager.searchSemantic(userId, query, limit);
  }
}

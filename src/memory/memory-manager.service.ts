import { Injectable, Logger } from '@nestjs/common';
import { LongTermMemoryService } from './long-term-memory.service';
import { LongTermMemory } from './entities/long-term-memory.entity';
import {
  SemanticMemoryMatch,
  SemanticMemoryService,
} from './semantic-memory.service';
import { ShortTermMemoryService } from './short-term-memory.service';

@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);

  constructor(
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly longTermMemory: LongTermMemoryService,
    private readonly semanticMemory: SemanticMemoryService,
  ) {}

  async getContext(
    sessionId: string,
    userId?: string,
    query?: string,
  ): Promise<string> {
    const [sessionContext, userContext, semanticContext] = await Promise.all([
      this.shortTermMemory.getContext(sessionId),
      this.longTermMemory.getContext(userId),
      this.semanticMemory.getContext(userId, query),
    ]);

    return [userContext, semanticContext, sessionContext]
      .filter(Boolean)
      .join('\n\n');
  }

  async saveTurn(
    sessionId: string,
    question: string,
    report: string,
  ): Promise<void> {
    await this.shortTermMemory.saveContext(sessionId, question, report);
  }

  async rememberFact(
    userId: string,
    fact: string,
  ): Promise<{ memory: LongTermMemory; semanticIndexed: boolean }> {
    const memory = await this.longTermMemory.remember(userId, fact);
    let semanticIndexed = true;
    try {
      await this.semanticMemory.store(memory.id, memory.userId, memory.fact);
    } catch (error) {
      semanticIndexed = false;
      this.logger.warn(
        `Stored PostgreSQL memory but semantic indexing failed: ${String(error)}`,
      );
    }
    return { memory, semanticIndexed };
  }

  searchSemantic(
    userId: string,
    query: string,
    limit?: number,
  ): Promise<SemanticMemoryMatch[]> {
    return this.semanticMemory.search(userId, query, limit);
  }
}

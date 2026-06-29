import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LongTermMemory } from './entities/long-term-memory.entity';

@Injectable()
export class LongTermMemoryService {
  private readonly logger = new Logger(LongTermMemoryService.name);
  private readonly maxFacts = 20;

  constructor(
    @InjectRepository(LongTermMemory)
    private readonly repository: Repository<LongTermMemory>,
  ) {}

  async remember(userId: string, fact: string): Promise<LongTermMemory> {
    const normalizedUserId = userId.trim();
    const normalizedFact = fact.trim();

    if (!normalizedUserId || normalizedUserId.length > 128) {
      throw new BadRequestException(
        'userId must contain between 1 and 128 characters',
      );
    }
    if (!normalizedFact || normalizedFact.length > 2_000) {
      throw new BadRequestException(
        'fact must contain between 1 and 2000 characters',
      );
    }

    const existing = await this.repository.findOne({
      where: { userId: normalizedUserId, fact: normalizedFact },
    });
    if (existing) {
      return existing;
    }

    const memory = this.repository.create({
      userId: normalizedUserId,
      fact: normalizedFact,
    });
    const saved = await this.repository.save(memory);
    this.logger.log(`Saved long-term memory for user ${normalizedUserId}`);
    return saved;
  }

  async findByUser(userId: string): Promise<LongTermMemory[]> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return [];
    }

    return this.repository.find({
      where: { userId: normalizedUserId },
      order: { updatedAt: 'DESC' },
      take: this.maxFacts,
    });
  }

  async getContext(userId?: string): Promise<string> {
    if (!userId) {
      return '';
    }

    const memories = await this.findByUser(userId);
    if (memories.length === 0) {
      return '';
    }

    return `Known user facts:\n${memories.map((memory) => `- ${memory.fact}`).join('\n')}`;
  }
}

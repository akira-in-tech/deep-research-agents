import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShortTermMemory } from './entities/short-term-memory.entity';

@Injectable()
export class ShortTermMemoryService {
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private readonly maxContextTurns = 5;
  private readonly maxReportCharacters = 1_500;

  // Inject the TypeORM repository for the ShortTermMemory table.
  constructor(
    @InjectRepository(ShortTermMemory)
    private readonly repo: Repository<ShortTermMemory>,
  ) {}

  /**
   * Save one research turn (question + report) into the session's history.
   */
  async saveContext(
    sessionId: string,
    question: string,
    report: string,
  ): Promise<void> {
    const entry = this.repo.create({ sessionId, question, report });
    await this.repo.save(entry);
    this.logger.log(`Saved context for session ${sessionId}`);
  }

  /**
   * Retrieve the most recent turns for a session, oldest first.
   * Reports are truncated so one long response cannot exhaust the LLM context.
   */
  async getContext(sessionId: string): Promise<string> {
    const entries = await this.repo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: this.maxContextTurns,
    });

    if (entries.length === 0) {
      return '';
    }

    const chronologicalEntries = entries.reverse();
    const lines = chronologicalEntries.flatMap((entry, index) => {
      const compactReport = entry.report.slice(0, this.maxReportCharacters);
      return [
        `${index + 1}. Previous question: ${entry.question}`,
        `   Previous answer: ${compactReport}`,
      ];
    });
    this.logger.log(
      `Loaded ${chronologicalEntries.length} prior turns for session ${sessionId}`,
    );
    return `Earlier in this session:\n${lines.join('\n')}`;
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ResearchRun } from './entities/research-run.entity';
import { ResearchQueueService } from './research-queue.service';
import { ResearchRunService } from './research-run.service';

@Injectable()
export class ResearchTaskService {
  constructor(
    private readonly runs: ResearchRunService,
    private readonly queue: ResearchQueueService,
  ) {}

  async start(
    question: string,
    sessionId?: string,
    userId?: string,
  ): Promise<ResearchRun> {
    const run = await this.runs.create(
      question,
      sessionId?.trim() || randomUUID(),
      userId?.trim() || undefined,
    );
    await this.queue.enqueue(run.id);
    return run;
  }

  async resume(runId: string): Promise<ResearchRun> {
    const run = await this.runs.get(runId);
    if (run.status === 'completed') {
      return run;
    }
    await this.queue.enqueue(run.id);
    return run;
  }
}

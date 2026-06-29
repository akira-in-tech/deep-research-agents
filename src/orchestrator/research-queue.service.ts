import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import { ResearchExecutionService } from './research-execution.service';

interface ResearchJobData {
  runId: string;
}

@Injectable()
export class ResearchQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchQueueService.name);
  private readonly enabled: boolean;
  private queue?: Queue<ResearchJobData, void, 'research'>;
  private worker?: Worker<ResearchJobData, void, 'research'>;

  constructor(
    private readonly config: ConfigService,
    private readonly execution: ResearchExecutionService,
  ) {
    this.enabled =
      config.get<string>('NODE_ENV') !== 'test' &&
      config.get<string>('QUEUE_ENABLED', 'true') !== 'false';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('BullMQ disabled; research jobs run in-process.');
      return;
    }

    const redisUrl = this.config.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    const connection = {
      url: redisUrl,
      maxRetriesPerRequest: null,
    };
    const configuredConcurrency = Number(
      this.config.get<string>('QUEUE_CONCURRENCY', '2'),
    );
    const concurrency =
      Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
        ? configuredConcurrency
        : 2;
    this.queue = new Queue<ResearchJobData, void, 'research'>('deep-research', {
      connection,
    });
    this.worker = new Worker<ResearchJobData, void, 'research'>(
      'deep-research',
      async (job: Job<ResearchJobData>) =>
        this.execution.execute(job.data.runId),
      {
        connection,
        concurrency,
      },
    );
    this.queue.on('error', (error) =>
      this.logger.error(`BullMQ queue error: ${error.message}`),
    );
    this.worker.on('error', (error) =>
      this.logger.error(`BullMQ worker error: ${error.message}`),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error(`BullMQ job ${job?.id ?? 'unknown'} failed`, error),
    );
  }

  async enqueue(runId: string): Promise<void> {
    if (!this.enabled || !this.queue) {
      void this.execution
        .execute(runId)
        .catch((error) =>
          this.logger.error(`In-process job ${runId} failed`, error),
        );
      return;
    }

    await this.queue.add(
      'research',
      { runId },
      {
        jobId: runId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

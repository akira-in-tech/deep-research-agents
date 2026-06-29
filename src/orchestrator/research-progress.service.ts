import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import IORedis from 'ioredis';
import { ResearchRun } from './entities/research-run.entity';

class RunAsyncIterator implements AsyncIterableIterator<ResearchRun> {
  private readonly queue: ResearchRun[] = [];
  private readonly waiting: Array<
    (result: IteratorResult<ResearchRun>) => void
  > = [];
  private closed = false;

  constructor(
    private readonly emitter: EventEmitter,
    private readonly eventName: string,
    private readonly onClose: () => void,
  ) {
    this.emitter.on(this.eventName, this.onEvent);
  }

  private readonly onEvent = (run: ResearchRun) => {
    const resolve = this.waiting.shift();
    if (resolve) {
      resolve({ value: run, done: false });
    } else {
      this.queue.push(run);
    }
  };

  next(): Promise<IteratorResult<ResearchRun>> {
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve({ value: queued, done: false });
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  return(): Promise<IteratorResult<ResearchRun>> {
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    this.closed = true;
    this.emitter.off(this.eventName, this.onEvent);
    this.onClose();
    for (const resolve of this.waiting.splice(0)) {
      resolve({ value: undefined, done: true });
    }
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ResearchRun> {
    return this;
  }
}

@Injectable()
export class ResearchProgressService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchProgressService.name);
  private readonly emitter = new EventEmitter();
  private readonly instanceId = randomUUID();
  private readonly subscriptionCounts = new Map<string, number>();
  private publisher?: IORedis;
  private subscriber?: IORedis;

  constructor(@Optional() private readonly config?: ConfigService) {}

  onModuleInit(): void {
    const enabled =
      this.config?.get<string>('NODE_ENV') !== 'test' &&
      this.config?.get<string>('REDIS_EVENTS_ENABLED', 'true') !== 'false';
    if (!enabled || !this.config) {
      return;
    }

    const redisUrl = this.config.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    this.publisher = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    this.subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    this.publisher.on('error', (error) =>
      this.logger.warn(`Redis progress publisher error: ${error.message}`),
    );
    this.subscriber.on('error', (error) =>
      this.logger.warn(`Redis progress subscriber error: ${error.message}`),
    );
    this.subscriber.on('message', (channel, raw) => {
      try {
        const payload = JSON.parse(raw) as {
          source: string;
          run: ResearchRun;
        };
        if (payload.source === this.instanceId) {
          return;
        }
        payload.run.createdAt = new Date(payload.run.createdAt);
        payload.run.updatedAt = new Date(payload.run.updatedAt);
        payload.run.startedAt = payload.run.startedAt
          ? new Date(payload.run.startedAt)
          : null;
        payload.run.completedAt = payload.run.completedAt
          ? new Date(payload.run.completedAt)
          : null;
        this.emitter.emit(channel, payload.run);
      } catch (error) {
        this.logger.warn(`Invalid Redis progress event: ${String(error)}`);
      }
    });
  }

  publish(run: ResearchRun): void {
    const channel = `research:${run.id}`;
    this.emitter.emit(channel, run);
    if (this.publisher) {
      void this.publisher
        .publish(channel, JSON.stringify({ source: this.instanceId, run }))
        .catch((error) =>
          this.logger.warn(`Redis progress publish failed: ${String(error)}`),
        );
    }
  }

  subscribe(runId: string): AsyncIterableIterator<ResearchRun> {
    const channel = `research:${runId}`;
    const count = (this.subscriptionCounts.get(channel) ?? 0) + 1;
    this.subscriptionCounts.set(channel, count);
    if (this.subscriber && count === 1) {
      void this.subscriber
        .subscribe(channel)
        .catch((error) =>
          this.logger.warn(`Redis progress subscribe failed: ${String(error)}`),
        );
    }
    return new RunAsyncIterator(this.emitter, channel, () =>
      this.releaseSubscription(channel),
    );
  }

  private releaseSubscription(channel: string): void {
    const count = this.subscriptionCounts.get(channel) ?? 0;
    if (count > 1) {
      this.subscriptionCounts.set(channel, count - 1);
      return;
    }
    this.subscriptionCounts.delete(channel);
    if (this.subscriber) {
      void this.subscriber
        .unsubscribe(channel)
        .catch((error) =>
          this.logger.warn(
            `Redis progress unsubscribe failed: ${String(error)}`,
          ),
        );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
    await this.publisher?.quit();
  }
}

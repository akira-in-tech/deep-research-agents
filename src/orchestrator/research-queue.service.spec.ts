import { ConfigService } from '@nestjs/config';
import { ResearchExecutionService } from './research-execution.service';
import { ResearchQueueService } from './research-queue.service';

describe('ResearchQueueService', () => {
  it('runs in-process when the queue is disabled for tests', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'NODE_ENV' ? 'test' : fallback,
      ),
    } as unknown as ConfigService;
    const execute = jest.fn().mockResolvedValue(undefined);
    const execution = { execute } as unknown as ResearchExecutionService;
    const service = new ResearchQueueService(config, execution);

    service.onModuleInit();
    await service.enqueue('run-1');

    expect(execute).toHaveBeenCalledWith('run-1');
  });
});

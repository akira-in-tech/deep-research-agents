import { ResearchRun } from './entities/research-run.entity';
import { ResearchProgressService } from './research-progress.service';

describe('ResearchProgressService', () => {
  it('streams updates for one research run', async () => {
    const service = new ResearchProgressService();
    const iterator = service.subscribe('run-1');
    const nextUpdate = iterator.next();
    const run = { id: 'run-1', status: 'running' } as ResearchRun;

    service.publish(run);

    await expect(nextUpdate).resolves.toEqual({ value: run, done: false });
    await expect(iterator.return?.()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });
});

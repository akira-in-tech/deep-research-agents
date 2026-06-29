import { Injectable, Logger } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { ResearchCheckpoint } from './research-checkpoint.interface';
import { ResearchRunService } from './research-run.service';

@Injectable()
export class ResearchExecutionService {
  private readonly logger = new Logger(ResearchExecutionService.name);
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly runs: ResearchRunService,
  ) {}

  async execute(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) {
      return;
    }
    this.activeRuns.add(runId);

    try {
      const run = await this.runs.get(runId);
      if (run.status === 'completed') {
        return;
      }

      await this.runs.markRunning(run.id);
      const result = await this.orchestrator.research(
        run.question,
        run.sessionId,
        run.userId ?? undefined,
        {
          checkpoint:
            (run.checkpoint as unknown as ResearchCheckpoint) ?? undefined,
          onProgress: async (update) => {
            await this.runs.updateProgress(run.id, update);
          },
          onCheckpoint: async (checkpoint) => {
            await this.runs.saveCheckpoint(run.id, checkpoint);
          },
        },
      );
      await this.runs.complete(run.id, result);
    } catch (error) {
      this.logger.error(`Research run ${runId} failed`, error);
      await this.runs.fail(runId, error);
      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }
}

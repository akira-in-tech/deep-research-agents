import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResearchResult } from './orchestrator.service';
import { ResearchCheckpoint } from './research-checkpoint.interface';
import { ResearchRun } from './entities/research-run.entity';
import { ResearchProgressService } from './research-progress.service';

@Injectable()
export class ResearchRunService {
  constructor(
    @InjectRepository(ResearchRun)
    private readonly repository: Repository<ResearchRun>,
    private readonly progress: ResearchProgressService,
  ) {}

  async create(
    question: string,
    sessionId: string,
    userId?: string,
  ): Promise<ResearchRun> {
    const run = this.repository.create({
      question,
      sessionId,
      userId: userId ?? null,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      executedQueries: [],
    });
    return this.saveAndPublish(run);
  }

  async get(id: string): Promise<ResearchRun> {
    const run = await this.repository.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Research run ${id} was not found`);
    }
    return run;
  }

  findRecent(sessionId?: string): Promise<ResearchRun[]> {
    return this.repository.find({
      where: sessionId ? { sessionId } : {},
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async metrics(): Promise<{
    totalRuns: number;
    runningRuns: number;
    completedRuns: number;
    failedRuns: number;
    averageDurationMs: number;
  }> {
    const raw = (await this.repository
      .createQueryBuilder('run')
      .select('COUNT(*)', 'totalRuns')
      .addSelect(
        `COUNT(*) FILTER (WHERE run.status = 'running')`,
        'runningRuns',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE run.status = 'completed')`,
        'completedRuns',
      )
      .addSelect(`COUNT(*) FILTER (WHERE run.status = 'failed')`, 'failedRuns')
      .addSelect('COALESCE(AVG(run."durationMs"), 0)', 'averageDurationMs')
      .getRawOne()) as Record<string, string>;

    return {
      totalRuns: Number(raw.totalRuns ?? 0),
      runningRuns: Number(raw.runningRuns ?? 0),
      completedRuns: Number(raw.completedRuns ?? 0),
      failedRuns: Number(raw.failedRuns ?? 0),
      averageDurationMs: Math.round(Number(raw.averageDurationMs ?? 0)),
    };
  }

  async markRunning(id: string): Promise<ResearchRun> {
    const run = await this.get(id);
    const isRetry = run.status === 'failed';
    run.status = 'running';
    run.error = null;
    run.startedAt = isRetry || !run.startedAt ? new Date() : run.startedAt;
    run.completedAt = null;
    run.durationMs = null;
    return this.saveAndPublish(run);
  }

  async updateProgress(
    id: string,
    values: {
      phase: string;
      progress: number;
      iterations?: number;
      evidenceCount?: number;
      executedQueries?: string[];
    },
  ): Promise<ResearchRun> {
    const run = await this.get(id);
    Object.assign(run, values);
    return this.saveAndPublish(run);
  }

  async saveCheckpoint(
    id: string,
    checkpoint: ResearchCheckpoint,
  ): Promise<ResearchRun> {
    const run = await this.get(id);
    run.checkpoint = checkpoint as unknown as Record<string, unknown>;
    run.iterations = checkpoint.iterationsRun;
    run.executedQueries = checkpoint.executedQueries;
    run.evidenceCount =
      checkpoint.allWebEvidence.length + checkpoint.allLocalEvidence.length;
    return this.saveAndPublish(run);
  }

  async complete(id: string, result: ResearchResult): Promise<ResearchRun> {
    const run = await this.get(id);
    run.status = 'completed';
    run.phase = 'completed';
    run.progress = 100;
    run.iterations = result.iterations;
    run.evidenceCount = result.evidenceCount;
    run.citationsUsed = result.citationsUsed;
    run.executedQueries = result.executedQueries;
    run.report = result.report;
    run.error = null;
    run.checkpoint = null;
    run.completedAt = new Date();
    run.durationMs = run.startedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : null;
    return this.saveAndPublish(run);
  }

  async fail(id: string, error: unknown): Promise<ResearchRun> {
    const run = await this.get(id);
    run.status = 'failed';
    run.phase = 'failed';
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date();
    run.durationMs = run.startedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : null;
    return this.saveAndPublish(run);
  }

  private async saveAndPublish(run: ResearchRun): Promise<ResearchRun> {
    const saved = await this.repository.save(run);
    this.progress.publish(saved);
    return saved;
  }
}

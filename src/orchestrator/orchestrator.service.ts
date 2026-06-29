import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IntentRouterService } from '../agents/intent-router/intent-router.service';
import { PlannerService } from '../agents/planner/planner.service';
import { WebScoutService } from '../agents/web-scout/web-scout.service';
import { LocalScoutService } from '../agents/local-scout/local-scout.service';
import {
  EvidenceJudgeService,
  JudgeResult,
} from '../agents/evidence-judge/evidence-judge.service';
import {
  AnalysisResult,
  AnalystService,
} from '../agents/analyst/analyst.service';
import { ReflectService } from '../agents/reflect/reflect.service';
import { WriterService } from '../agents/writer/writer.service';
import { DirectResponderService } from '../agents/direct-responder/direct-responder.service';
import { Evidence, SearchQuery } from '../core/research-state.interface';
import { MemoryManagerService } from '../memory/memory-manager.service';
import {
  ResearchCheckpoint,
  ResearchExecutionOptions,
} from './research-checkpoint.interface';

// The final result returned to the caller.
export interface ResearchResult {
  sessionId: string;
  userId: string | null;
  route: string;
  report: string;
  iterations: number;
  evidenceCount: number;
  webEvidenceCount: number;
  localEvidenceCount: number;
  executedQueries: string[];
  citationsUsed: number;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly absoluteMaxIterations = 3;
  private readonly maxQueriesPerSource = 6;

  constructor(
    private readonly intentRouter: IntentRouterService,
    private readonly planner: PlannerService,
    private readonly webScout: WebScoutService,
    private readonly localScout: LocalScoutService,
    private readonly evidenceJudge: EvidenceJudgeService,
    private readonly analyst: AnalystService,
    private readonly reflect: ReflectService,
    private readonly writer: WriterService,
    private readonly directResponder: DirectResponderService,
    private readonly memoryManager: MemoryManagerService,
  ) {}

  private resolveSessionId(sessionId?: string): string {
    if (!sessionId) {
      return randomUUID();
    }

    const normalized = sessionId.trim();
    if (!normalized || normalized.length > 128) {
      throw new BadRequestException(
        'sessionId must contain between 1 and 128 characters',
      );
    }

    return normalized;
  }

  private resolveUserId(userId?: string): string | undefined {
    if (!userId) {
      return undefined;
    }

    const normalized = userId.trim();
    if (!normalized || normalized.length > 128) {
      throw new BadRequestException(
        'userId must contain between 1 and 128 characters',
      );
    }

    return normalized;
  }

  private clampInteger(
    value: number,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
  }

  private queriesForSource(
    searchPlan: SearchQuery[],
    source: 'web' | 'local',
  ): string[] {
    const uniqueQueries = new Set<string>();

    for (const item of searchPlan) {
      const query = item.query?.trim();
      const preference = item.sourcePreference?.toLowerCase();
      if (query && (preference === source || preference === 'hybrid')) {
        uniqueQueries.add(query);
      }
    }

    return [...uniqueQueries].slice(0, this.maxQueriesPerSource);
  }

  /**
   * Run the full multi-agent research pipeline end to end.
   * Mirrors the state-machine flow: route -> plan -> (retrieve ->
   * judge -> analyze -> reflect)* -> write.
   */
  async research(
    query: string,
    sessionId?: string,
    userId?: string,
    options: ResearchExecutionOptions = {},
  ): Promise<ResearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('question must not be empty');
    }

    const resolvedSessionId = this.resolveSessionId(sessionId);
    const resolvedUserId = this.resolveUserId(userId);
    const memoryContext = await this.memoryManager.getContext(
      resolvedSessionId,
      resolvedUserId,
      normalizedQuery,
    );
    this.logger.log(`Starting research for: "${normalizedQuery}"`);

    const emitProgress = async (
      phase: string,
      progress: number,
      values: {
        iterations?: number;
        evidenceCount?: number;
        executedQueries?: string[];
      } = {},
    ) => {
      await options.onProgress?.({ phase, progress, ...values });
    };

    // Step 1: intent routing.
    await emitProgress('routing', 10);
    const route =
      options.checkpoint?.route ??
      (await this.intentRouter.route(normalizedQuery, memoryContext));
    if (route !== 'multiagent') {
      const directAnswer = await this.directResponder.answer(
        normalizedQuery,
        memoryContext,
      );
      await this.memoryManager.saveTurn(
        resolvedSessionId,
        normalizedQuery,
        directAnswer,
      );

      return {
        sessionId: resolvedSessionId,
        userId: resolvedUserId ?? null,
        route,
        report: directAnswer,
        iterations: 0,
        evidenceCount: 0,
        webEvidenceCount: 0,
        localEvidenceCount: 0,
        executedQueries: [],
        citationsUsed: 0,
      };
    }

    // Step 2: planning.
    await emitProgress('planning', 20);
    const plan =
      options.checkpoint?.plan ??
      (await this.planner.plan(normalizedQuery, memoryContext));
    let currentSearchPlan =
      options.checkpoint?.currentSearchPlan ?? plan.searchPlan;
    if (currentSearchPlan.length === 0) {
      currentSearchPlan = [
        {
          sectionId: 'fallback',
          query: normalizedQuery,
          sourcePreference: 'hybrid',
          reason: 'No valid planner search query was returned',
        },
      ];
    }

    const maxIterations = this.clampInteger(
      plan.budget.maxRounds,
      2,
      1,
      this.absoluteMaxIterations,
    );
    const maxSources = this.clampInteger(plan.budget.maxSources, 12, 1, 50);
    const executedQueries = new Set<string>(
      options.checkpoint?.executedQueries ?? [],
    );

    let allWebEvidence: Evidence[] = options.checkpoint?.allWebEvidence ?? [];
    let allLocalEvidence: Evidence[] =
      options.checkpoint?.allLocalEvidence ?? [];
    let analysis: AnalysisResult | undefined = options.checkpoint?.analysis;
    let judged: JudgeResult | undefined = options.checkpoint?.judged;
    let iterationsRun = options.checkpoint?.iterationsRun ?? 0;
    let readyToWrite = options.checkpoint?.readyToWrite ?? false;

    const saveCheckpoint = async () => {
      const checkpoint: ResearchCheckpoint = {
        route,
        plan,
        currentSearchPlan,
        allWebEvidence,
        allLocalEvidence,
        analysis,
        judged,
        iterationsRun,
        executedQueries: [...executedQueries],
        readyToWrite,
      };
      await options.onCheckpoint?.(checkpoint);
    };
    await saveCheckpoint();

    // Step 3: iterative research loop.
    for (
      let iteration = iterationsRun + 1;
      iteration <= maxIterations && !readyToWrite;
      iteration++
    ) {
      iterationsRun = iteration;
      this.logger.log(`Iteration ${iteration}: retrieval`);
      await emitProgress('retrieving', 25 + iteration * 15, {
        iterations: iteration,
        evidenceCount: allWebEvidence.length + allLocalEvidence.length,
        executedQueries: [...executedQueries],
      });

      const webQueries = this.queriesForSource(currentSearchPlan, 'web');
      const localQueries = this.queriesForSource(currentSearchPlan, 'local');
      [...webQueries, ...localQueries].forEach((searchQuery) =>
        executedQueries.add(searchQuery),
      );

      const [webEvidence, localEvidence] = await Promise.all([
        this.webScout.scout(
          normalizedQuery,
          plan.subQuestions,
          webQueries,
          iteration,
        ),
        this.localScout.scout(
          normalizedQuery,
          plan.subQuestions,
          localQueries,
          iteration,
        ),
      ]);
      allWebEvidence = [...allWebEvidence, ...webEvidence];
      allLocalEvidence = [...allLocalEvidence, ...localEvidence];

      const cappedEvidence = [...allWebEvidence, ...allLocalEvidence].slice(
        0,
        maxSources,
      );
      allWebEvidence = cappedEvidence.filter(
        (evidence) => evidence.sourceType === 'web',
      );
      allLocalEvidence = cappedEvidence.filter(
        (evidence) => evidence.sourceType === 'local',
      );

      judged = await this.evidenceJudge.judge(
        normalizedQuery,
        plan.subQuestions,
        allWebEvidence,
        allLocalEvidence,
      );

      await emitProgress('analyzing', 50 + iteration * 10, {
        iterations: iteration,
        evidenceCount: judged.evidencePool.length,
        executedQueries: [...executedQueries],
      });
      analysis = await this.analyst.analyze(
        normalizedQuery,
        plan.subQuestions,
        judged.evidencePool,
        judged.auditFlags,
      );

      await saveCheckpoint();

      // Stop if evidence is sufficient or we hit the iteration cap.
      if (!analysis.needsMoreResearch || iteration === maxIterations) {
        readyToWrite = true;
        await saveCheckpoint();
        break;
      }

      // Otherwise reflect to generate new queries and loop again.
      const supplementary = await this.reflect.reflect(
        normalizedQuery,
        plan.subQuestions,
        [...executedQueries],
        analysis.missingGaps,
      );
      await emitProgress('reflecting', 65 + iteration * 10, {
        iterations: iteration,
        evidenceCount: judged.evidencePool.length,
        executedQueries: [...executedQueries],
      });
      currentSearchPlan = supplementary.filter((item) => {
        const queryText = item.query?.trim();
        return queryText && !executedQueries.has(queryText);
      });

      if (currentSearchPlan.length === 0) {
        this.logger.warn('Reflect produced no new search queries; stopping.');
        readyToWrite = true;
        await saveCheckpoint();
        break;
      }
      await saveCheckpoint();
    }

    if (!analysis || !judged) {
      throw new InternalServerErrorException(
        'Research pipeline ended before evidence analysis completed',
      );
    }

    // Step 4: write the final report.
    await emitProgress('writing', 90, {
      iterations: iterationsRun,
      evidenceCount: judged.evidencePool.length,
      executedQueries: [...executedQueries],
    });
    const report = await this.writer.write(
      normalizedQuery,
      plan.subQuestions,
      analysis.findings,
      judged.sourceIndex,
      judged.auditFlags,
    );

    // Count citations actually used in the final report.
    const citationsUsed = (report.final.match(/\[([A-Z]+\d+_\d+-\d+)\]/g) ?? [])
      .length;

    await this.memoryManager.saveTurn(
      resolvedSessionId,
      normalizedQuery,
      report.final,
    );

    this.logger.log('Research complete.');
    return {
      sessionId: resolvedSessionId,
      userId: resolvedUserId ?? null,
      route,
      report: report.final,
      iterations: iterationsRun,
      evidenceCount: judged.evidencePool.length,
      webEvidenceCount: allWebEvidence.length,
      localEvidenceCount: allLocalEvidence.length,
      executedQueries: [...executedQueries],
      citationsUsed,
    };
  }
}

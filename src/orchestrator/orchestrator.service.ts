import { Injectable, Logger } from '@nestjs/common';
import { IntentRouterService } from '../agents/intent-router/intent-router.service';
import { PlannerService } from '../agents/planner/planner.service';
import { WebScoutService } from '../agents/web-scout/web-scout.service';
import { LocalScoutService } from '../agents/local-scout/local-scout.service';
import { EvidenceJudgeService } from '../agents/evidence-judge/evidence-judge.service';
import { AnalystService } from '../agents/analyst/analyst.service';
import { ReflectService } from '../agents/reflect/reflect.service';
import { WriterService } from '../agents/writer/writer.service';
import { Evidence } from '../core/research-state.interface';

// The final result returned to the caller.
export interface ResearchResult {
  route: string;
  report: string;
  iterations: number;
  evidenceCount: number;
  citationsUsed: number;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly MAX_ITERATIONS = 2;

  constructor(
    private readonly intentRouter: IntentRouterService,
    private readonly planner: PlannerService,
    private readonly webScout: WebScoutService,
    private readonly localScout: LocalScoutService,
    private readonly evidenceJudge: EvidenceJudgeService,
    private readonly analyst: AnalystService,
    private readonly reflect: ReflectService,
    private readonly writer: WriterService,
  ) {}

  /**
   * Run the full multi-agent research pipeline end to end.
   * Mirrors the state-machine flow: route -> plan -> (retrieve ->
   * judge -> analyze -> reflect)* -> write.
   */
  async research(query: string): Promise<ResearchResult> {
    this.logger.log(`Starting research for: "${query}"`);

    // Step 1: intent routing.
    const route = await this.intentRouter.route(query);
    if (route !== 'multiagent') {
      return {
        route,
        report: 'This query was routed to a direct answer (no deep research needed).',
        iterations: 0,
        evidenceCount: 0,
        citationsUsed: 0,
      };
    }

    // Step 2: planning.
    const plan = await this.planner.plan(query);
    let searchQueries = plan.searchPlan.slice(0, 2).map((s) => s.query);

    let allWebEvidence: Evidence[] = [];
    let allLocalEvidence: Evidence[] = [];
    let analysis;
    let judged;
    let iterationsRun = 0;

    // Step 3: iterative research loop.
    for (let iteration = 1; iteration <= this.MAX_ITERATIONS; iteration++) {
      iterationsRun = iteration;
      this.logger.log(`Iteration ${iteration}: retrieval`);

      const [webEvidence, localEvidence] = await Promise.all([
        this.webScout.scout(query, plan.subQuestions, searchQueries, iteration),
        this.localScout.scout(query, plan.subQuestions, searchQueries, iteration),
      ]);
      allWebEvidence = [...allWebEvidence, ...webEvidence];
      allLocalEvidence = [...allLocalEvidence, ...localEvidence];

      judged = await this.evidenceJudge.judge(
        query,
        plan.subQuestions,
        allWebEvidence,
        allLocalEvidence,
      );

      analysis = await this.analyst.analyze(
        query,
        plan.subQuestions,
        judged.evidencePool,
        judged.auditFlags,
      );

      // Stop if evidence is sufficient or we hit the iteration cap.
      if (!analysis.needsMoreResearch || iteration === this.MAX_ITERATIONS) {
        break;
      }

      // Otherwise reflect to generate new queries and loop again.
      const supplementary = await this.reflect.reflect(
        query,
        plan.subQuestions,
        searchQueries,
        analysis.missingGaps,
      );
      searchQueries = supplementary.slice(0, 2).map((s) => s.query);
    }

    // Step 4: write the final report.
    const report = await this.writer.write(
      query,
      plan.subQuestions,
      analysis!.findings,
      judged!.sourceIndex,
      judged!.auditFlags,
    );

    // Count citations actually used in the final report.
    const citationsUsed = (report.final.match(/\[([A-Z]+\d+_\d+-\d+)\]/g) ?? []).length;

    this.logger.log('Research complete.');
    return {
      route,
      report: report.final,
      iterations: iterationsRun,
      evidenceCount: judged!.evidencePool.length,
      citationsUsed,
    };
  }
}
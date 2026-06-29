import { AnalysisResult } from '../agents/analyst/analyst.service';
import { JudgeResult } from '../agents/evidence-judge/evidence-judge.service';
import { PlanResult } from '../agents/planner/planner.service';
import { Evidence, SearchQuery } from '../core/research-state.interface';
import { IntentRoute } from '../agents/intent-router/intent-router.service';

export interface ResearchCheckpoint {
  route: IntentRoute;
  plan: PlanResult;
  currentSearchPlan: SearchQuery[];
  allWebEvidence: Evidence[];
  allLocalEvidence: Evidence[];
  analysis?: AnalysisResult;
  judged?: JudgeResult;
  iterationsRun: number;
  executedQueries: string[];
  readyToWrite: boolean;
}

export interface ResearchProgressUpdate {
  phase: string;
  progress: number;
  iterations?: number;
  evidenceCount?: number;
  executedQueries?: string[];
}

export interface ResearchExecutionOptions {
  checkpoint?: ResearchCheckpoint;
  onProgress?: (update: ResearchProgressUpdate) => Promise<void>;
  onCheckpoint?: (checkpoint: ResearchCheckpoint) => Promise<void>;
}

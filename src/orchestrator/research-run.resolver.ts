import { Args, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { ResearchRun } from './entities/research-run.entity';
import { ResearchProgressService } from './research-progress.service';
import { ResearchRunView, ResearchSystemMetrics } from './research-run.model';
import { ResearchRunService } from './research-run.service';
import { ResearchTaskService } from './research-task.service';

@Resolver(() => ResearchRunView)
export class ResearchRunResolver {
  constructor(
    private readonly tasks: ResearchTaskService,
    private readonly runs: ResearchRunService,
    private readonly progress: ResearchProgressService,
  ) {}

  @Mutation(() => ResearchRunView)
  startResearch(
    @Args('question') question: string,
    @Args('sessionId', { nullable: true }) sessionId?: string,
    @Args('userId', { nullable: true }) userId?: string,
  ): Promise<ResearchRunView> {
    return this.tasks.start(question, sessionId, userId);
  }

  @Mutation(() => ResearchRunView)
  resumeResearch(@Args('runId') runId: string): Promise<ResearchRunView> {
    return this.tasks.resume(runId);
  }

  @Query(() => ResearchRunView)
  researchRun(@Args('runId') runId: string): Promise<ResearchRunView> {
    return this.runs.get(runId);
  }

  @Query(() => [ResearchRunView])
  researchRuns(
    @Args('sessionId', { nullable: true }) sessionId?: string,
  ): Promise<ResearchRunView[]> {
    return this.runs.findRecent(sessionId);
  }

  @Query(() => ResearchSystemMetrics)
  researchMetrics(): Promise<ResearchSystemMetrics> {
    return this.runs.metrics();
  }

  @Subscription(() => ResearchRunView, {
    resolve: (run: ResearchRun) => run,
  })
  researchProgress(
    @Args('runId') runId: string,
  ): AsyncIterableIterator<ResearchRun> {
    return this.progress.subscribe(runId);
  }
}

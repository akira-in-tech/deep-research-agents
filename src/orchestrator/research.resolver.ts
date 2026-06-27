import { Resolver, Query, Args } from '@nestjs/graphql';
import { ResearchReport } from './research.model';
import { OrchestratorService } from './orchestrator.service';

@Resolver()
export class ResearchResolver {
  constructor(private readonly orchestrator: OrchestratorService) {}

  /**
   * GraphQL query entry point. Triggers the full multi-agent
   * research pipeline and returns the structured report.
   */
  @Query(() => ResearchReport)
  async research(
    @Args('question') question: string,
  ): Promise<ResearchReport> {
    return this.orchestrator.research(question);
  }
}
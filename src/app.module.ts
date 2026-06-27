import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ResearchResolver } from './orchestrator/research.resolver';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from './llm/llm.module';
import { IntentRouterService } from './agents/intent-router/intent-router.service';
import { PlannerService } from './agents/planner/planner.service';
import { WebScoutService } from './agents/web-scout/web-scout.service';
import { LocalScoutService } from './agents/local-scout/local-scout.service';
import { EvidenceJudgeService } from './agents/evidence-judge/evidence-judge.service';
import { AnalystService } from './agents/analyst/analyst.service';
import { ReflectService } from './agents/reflect/reflect.service';
import { WriterService } from './agents/writer/writer.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      playground: true,
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    IntentRouterService,
    PlannerService,
    WebScoutService,
    LocalScoutService,
    EvidenceJudgeService,
    AnalystService,
    ReflectService,
    WriterService,
    OrchestratorService,
    ResearchResolver,
  ],
})
export class AppModule {}

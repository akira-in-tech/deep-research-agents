import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ResearchResolver } from './orchestrator/research.resolver';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { IntentRouterService } from './agents/intent-router/intent-router.service';
import { PlannerService } from './agents/planner/planner.service';
import { WebScoutService } from './agents/web-scout/web-scout.service';
import { LocalScoutService } from './agents/local-scout/local-scout.service';
import { EvidenceJudgeService } from './agents/evidence-judge/evidence-judge.service';
import { AnalystService } from './agents/analyst/analyst.service';
import { ReflectService } from './agents/reflect/reflect.service';
import { WriterService } from './agents/writer/writer.service';
import { DirectResponderService } from './agents/direct-responder/direct-responder.service';
import { MemoryModule } from './memory/memory.module';
import { ResearchRun } from './orchestrator/entities/research-run.entity';
import { ResearchProgressService } from './orchestrator/research-progress.service';
import { ResearchRunResolver } from './orchestrator/research-run.resolver';
import { ResearchRunService } from './orchestrator/research-run.service';
import { ResearchTaskService } from './orchestrator/research-task.service';
import { ResearchExecutionService } from './orchestrator/research-execution.service';
import { ResearchQueueService } from './orchestrator/research-queue.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    MemoryModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: process.env.NODE_ENV !== 'production',
      subscriptions: {
        'graphql-ws': true,
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('POSTGRES_DSN');
        const baseOptions = {
          type: 'postgres' as const,
          autoLoadEntities: true,
          synchronize:
            config.get<string>(
              'TYPEORM_SYNC',
              config.get<string>('NODE_ENV') === 'production'
                ? 'false'
                : 'true',
            ) === 'true',
          migrationsRun:
            config.get<string>('TYPEORM_MIGRATIONS_RUN', 'false') === 'true',
          migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
          retryAttempts: 3,
          retryDelay: 1_000,
        };

        if (databaseUrl) {
          return { ...baseOptions, url: databaseUrl };
        }

        return {
          ...baseOptions,
          host: config.get<string>('POSTGRES_HOST', 'localhost'),
          port: config.get<number>('POSTGRES_PORT', 5433),
          username: config.get<string>('POSTGRES_USER', 'research'),
          password: config.get<string>('POSTGRES_PASSWORD', 'research'),
          database: config.get<string>('POSTGRES_DB', 'research_memory'),
        };
      },
    }),
    TypeOrmModule.forFeature([ResearchRun]),
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
    DirectResponderService,
    OrchestratorService,
    ResearchResolver,
    ResearchProgressService,
    ResearchRunService,
    ResearchExecutionService,
    ResearchQueueService,
    ResearchTaskService,
    ResearchRunResolver,
  ],
})
export class AppModule {}

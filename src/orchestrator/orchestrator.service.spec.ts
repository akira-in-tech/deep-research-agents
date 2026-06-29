/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { AnalystService } from '../agents/analyst/analyst.service';
import { DirectResponderService } from '../agents/direct-responder/direct-responder.service';
import { EvidenceJudgeService } from '../agents/evidence-judge/evidence-judge.service';
import { IntentRouterService } from '../agents/intent-router/intent-router.service';
import { LocalScoutService } from '../agents/local-scout/local-scout.service';
import { PlannerService } from '../agents/planner/planner.service';
import { ReflectService } from '../agents/reflect/reflect.service';
import { WebScoutService } from '../agents/web-scout/web-scout.service';
import { WriterService } from '../agents/writer/writer.service';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { OrchestratorService } from './orchestrator.service';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let intentRouter: jest.Mocked<IntentRouterService>;
  let planner: jest.Mocked<PlannerService>;
  let webScout: jest.Mocked<WebScoutService>;
  let localScout: jest.Mocked<LocalScoutService>;
  let evidenceJudge: jest.Mocked<EvidenceJudgeService>;
  let analyst: jest.Mocked<AnalystService>;
  let reflect: jest.Mocked<ReflectService>;
  let writer: jest.Mocked<WriterService>;
  let directResponder: jest.Mocked<DirectResponderService>;
  let memory: jest.Mocked<MemoryManagerService>;

  beforeEach(() => {
    intentRouter = {
      route: jest.fn(),
    } as unknown as jest.Mocked<IntentRouterService>;
    planner = { plan: jest.fn() } as unknown as jest.Mocked<PlannerService>;
    webScout = { scout: jest.fn() } as unknown as jest.Mocked<WebScoutService>;
    localScout = {
      scout: jest.fn(),
    } as unknown as jest.Mocked<LocalScoutService>;
    evidenceJudge = {
      judge: jest.fn(),
    } as unknown as jest.Mocked<EvidenceJudgeService>;
    analyst = { analyze: jest.fn() } as unknown as jest.Mocked<AnalystService>;
    reflect = { reflect: jest.fn() } as unknown as jest.Mocked<ReflectService>;
    writer = { write: jest.fn() } as unknown as jest.Mocked<WriterService>;
    directResponder = {
      answer: jest.fn(),
    } as unknown as jest.Mocked<DirectResponderService>;
    memory = {
      getContext: jest.fn(),
      saveTurn: jest.fn(),
    } as unknown as jest.Mocked<MemoryManagerService>;

    memory.getContext.mockResolvedValue('');
    memory.saveTurn.mockResolvedValue();

    service = new OrchestratorService(
      intentRouter,
      planner,
      webScout,
      localScout,
      evidenceJudge,
      analyst,
      reflect,
      writer,
      directResponder,
      memory,
    );
  });

  it('answers a direct question and stores the turn', async () => {
    memory.getContext.mockResolvedValue('Earlier context');
    intentRouter.route.mockResolvedValue('direct');
    directResponder.answer.mockResolvedValue('Direct answer');

    const result = await service.research('Hello', 'session-1', 'user-1');

    expect(result).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      route: 'direct',
      report: 'Direct answer',
      iterations: 0,
      evidenceCount: 0,
      webEvidenceCount: 0,
      localEvidenceCount: 0,
      executedQueries: [],
      citationsUsed: 0,
    });
    expect(directResponder.answer).toHaveBeenCalledWith(
      'Hello',
      'Earlier context',
    );
    expect(memory.getContext).toHaveBeenCalledWith(
      'session-1',
      'user-1',
      'Hello',
    );
    expect(memory.saveTurn).toHaveBeenCalledWith(
      'session-1',
      'Hello',
      'Direct answer',
    );
  });

  it('runs the research pipeline and stores the final report', async () => {
    const onProgress = jest.fn().mockResolvedValue(undefined);
    const onCheckpoint = jest.fn().mockResolvedValue(undefined);
    intentRouter.route.mockResolvedValue('multiagent');
    planner.plan.mockResolvedValue({
      objective: 'Research objective',
      subQuestions: ['Question'],
      outline: [],
      searchPlan: [
        {
          sectionId: 'sec_1',
          query: 'search query',
          sourcePreference: 'web',
          reason: 'test',
        },
      ],
      budget: {
        maxRounds: 2,
        maxSources: 12,
        maxTokens: 12_000,
        maxSeconds: 45,
      },
    });
    webScout.scout.mockResolvedValue([
      {
        sourceId: 'WEB1_1-1',
        sourceType: 'web',
        title: 'Source',
        url: 'https://example.com',
        snippet: 'Evidence',
        supportsQuestions: ['Question'],
      },
    ]);
    localScout.scout.mockResolvedValue([]);
    evidenceJudge.judge.mockResolvedValue({
      evidencePool: [
        {
          sourceId: 'WEB1_1-1',
          sourceType: 'web',
          title: 'Source',
          url: 'https://example.com',
          snippet: 'Evidence',
          supportsQuestions: ['Question'],
        },
      ],
      auditFlags: [],
      sourceIndex: [
        {
          sourceId: 'WEB1_1-1',
          sourceType: 'web',
          label: 'Source',
          locator: 'https://example.com',
        },
      ],
    });
    analyst.analyze.mockResolvedValue({
      analysis: 'Analysis',
      findings: [
        {
          claimId: 'c_1',
          claim: 'Finding',
          confidence: 'high',
          sourceIds: ['WEB1_1-1'],
        },
      ],
      claimMap: [{ claimId: 'c_1', sourceIds: ['WEB1_1-1'] }],
      needsMoreResearch: false,
      missingGaps: [],
    });
    writer.write.mockResolvedValue({
      draft: 'Report [WEB1_1-1]',
      final: 'Report [WEB1_1-1]',
    });

    const result = await service.research(
      'Research this',
      'session-2',
      undefined,
      { onProgress, onCheckpoint },
    );

    expect(result.route).toBe('multiagent');
    expect(result.evidenceCount).toBe(1);
    expect(result.webEvidenceCount).toBe(1);
    expect(result.localEvidenceCount).toBe(0);
    expect(result.executedQueries).toEqual(['search query']);
    expect(result.citationsUsed).toBe(1);
    expect(webScout.scout).toHaveBeenCalledWith(
      'Research this',
      ['Question'],
      ['search query'],
      1,
    );
    expect(localScout.scout).toHaveBeenCalledWith(
      'Research this',
      ['Question'],
      [],
      1,
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'writing', progress: 90 }),
    );
    expect(onCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({ iterationsRun: 1, readyToWrite: true }),
    );
    expect(memory.saveTurn).toHaveBeenCalledWith(
      'session-2',
      'Research this',
      'Report [WEB1_1-1]',
    );
  });

  it('rejects an empty question before reading memory', async () => {
    await expect(service.research('   ', 'session-3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(memory.getContext).not.toHaveBeenCalled();
  });
});

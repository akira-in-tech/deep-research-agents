import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/graphql exposes research and memory operations', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query:
          '{ __schema { queryType { fields { name } } mutationType { fields { name } } subscriptionType { fields { name } } } }',
      })
      .expect(200);

    const body = response.body as {
      data: {
        __schema: {
          queryType: { fields: { name: string }[] };
          mutationType: { fields: { name: string }[] };
          subscriptionType: { fields: { name: string }[] };
        };
      };
    };
    const schema = body.data.__schema;
    expect(schema.queryType.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'research',
        'longTermMemories',
        'semanticMemories',
        'researchRun',
        'researchRuns',
        'researchMetrics',
      ]),
    );
    expect(schema.mutationType.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'rememberFact',
        'startResearch',
        'resumeResearch',
      ]),
    );
    expect(schema.subscriptionType.fields.map((field) => field.name)).toContain(
      'researchProgress',
    );
  });

  it('/graphql reads persisted research runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ researchRuns { id status phase progress } }' })
      .expect(200);

    const body = response.body as {
      data?: { researchRuns: unknown[] };
      errors?: unknown[];
    };
    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.researchRuns)).toBe(true);
  });

  it('/graphql returns research system metrics', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query:
          '{ researchMetrics { totalRuns runningRuns completedRuns failedRuns averageDurationMs } }',
      })
      .expect(200);

    const body = response.body as {
      data?: {
        researchMetrics: Record<string, number>;
      };
      errors?: unknown[];
    };
    expect(body.errors).toBeUndefined();
    expect(body.data?.researchMetrics.totalRuns).toBeGreaterThanOrEqual(0);
    expect(body.data?.researchMetrics.averageDurationMs).toBeGreaterThanOrEqual(
      0,
    );
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });
});

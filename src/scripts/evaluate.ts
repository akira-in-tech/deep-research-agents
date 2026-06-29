import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

interface EvaluationCase {
  id: string;
  question: string;
  expectedRoute: string;
}

interface EvaluationResult {
  id: string;
  passed: boolean;
  expectedRoute: string;
  actualRoute: string | null;
  durationMs: number;
  evidenceCount: number;
  citationCount: number;
  reportCharacters: number;
  error: string | null;
}

async function main() {
  process.env.QUEUE_ENABLED ??= 'false';
  process.env.REDIS_EVENTS_ENABLED ??= 'false';
  const datasetPath = path.join(process.cwd(), 'evaluation/dataset.json');
  const dataset = JSON.parse(
    fs.readFileSync(datasetPath, 'utf8'),
  ) as EvaluationCase[];
  const limit = Math.max(
    1,
    Math.min(dataset.length, Number(process.env.EVAL_LIMIT ?? dataset.length)),
  );
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const orchestrator = app.get(OrchestratorService);
    const results: EvaluationResult[] = [];

    for (const item of dataset.slice(0, limit)) {
      const startedAt = Date.now();
      try {
        const result = await orchestrator.research(
          item.question,
          `eval-${item.id}`,
          'evaluation-user',
        );
        const citations = result.report.match(/\[([A-Z]+\d+_\d+-\d+)\]/g) ?? [];
        results.push({
          id: item.id,
          passed: result.route === item.expectedRoute,
          expectedRoute: item.expectedRoute,
          actualRoute: result.route,
          durationMs: Date.now() - startedAt,
          evidenceCount: result.evidenceCount,
          citationCount: citations.length,
          reportCharacters: result.report.length,
          error: null,
        });
      } catch (error) {
        results.push({
          id: item.id,
          passed: false,
          expectedRoute: item.expectedRoute,
          actualRoute: null,
          durationMs: Date.now() - startedAt,
          evidenceCount: 0,
          citationCount: 0,
          reportCharacters: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const passed = results.filter((result) => result.passed).length;
    const summary = {
      generatedAt: new Date().toISOString(),
      total: results.length,
      passed,
      routeAccuracy: results.length > 0 ? passed / results.length : 0,
      averageDurationMs:
        results.length > 0
          ? results.reduce((sum, result) => sum + result.durationMs, 0) /
            results.length
          : 0,
      results,
    };
    const outputPath = path.join(
      process.cwd(),
      `evaluation/results-${Date.now()}.json`,
    );
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

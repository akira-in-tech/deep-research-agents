import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const memory = app.get(ShortTermMemoryService);
  const sessionId = `memory-smoke-${Date.now()}`;

  await memory.saveContext(
    sessionId,
    'Investigate the best AI products of 2026',
    'Report: ChatGPT, Claude, and Gemini are leading products.',
  );
  await memory.saveContext(
    sessionId,
    'Which of those is best for coding?',
    'Report: The answer depends on the coding task and evaluation criteria.',
  );

  const context = await memory.getContext(sessionId);
  console.log(context);
  await app.close();
}

void main();

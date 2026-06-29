import { NestFactory } from '@nestjs/core';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { AppModule } from './app.module';
import { OrchestratorService } from './orchestrator/orchestrator.service';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  process.env.QUEUE_ENABLED ??= 'false';
  process.env.REDIS_EVENTS_ENABLED ??= 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  let terminal: ReturnType<typeof createInterface> | undefined;

  try {
    const orchestrator = app.get(OrchestratorService);
    const sessionId = argument('session');
    const userId = argument('user');
    const oneTimeQuestion = argument('question');

    if (oneTimeQuestion) {
      const result = await orchestrator.research(
        oneTimeQuestion,
        sessionId,
        userId,
      );
      console.log(result.report);
      return;
    }

    terminal = createInterface({ input, output });
    console.log('DeepResearch CLI. Type exit to quit.');
    while (true) {
      const question = (await terminal.question('research> ')).trim();
      if (!question || question.toLowerCase() === 'exit') {
        break;
      }
      const result = await orchestrator.research(question, sessionId, userId);
      console.log(`\n${result.report}\n`);
    }
  } finally {
    terminal?.close();
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

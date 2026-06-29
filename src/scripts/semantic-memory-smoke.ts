import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MemoryManagerService } from '../memory/memory-manager.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const memory = app.get(MemoryManagerService);
  const userId = 'semantic-memory-smoke-user';
  const fact = 'The user prefers concise technical reports with citations.';

  const stored = await memory.rememberFact(userId, fact);
  if (!stored.semanticIndexed) {
    throw new Error('PostgreSQL succeeded but semantic indexing failed');
  }

  const matches = await memory.searchSemantic(
    userId,
    'How should reports be written for this user?',
  );
  if (!matches.some((match) => match.text === fact)) {
    throw new Error('Stored semantic memory was not retrieved');
  }

  console.log(
    JSON.stringify(
      {
        semanticIndexed: stored.semanticIndexed,
        topMatch: matches[0],
      },
      null,
      2,
    ),
  );
  await app.close();
}

void main();

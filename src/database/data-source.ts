import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { LongTermMemory } from '../memory/entities/long-term-memory.entity';
import { ShortTermMemory } from '../memory/entities/short-term-memory.entity';
import { ResearchRun } from '../orchestrator/entities/research-run.entity';

dotenv.config();

const databaseUrl = process.env.POSTGRES_DSN;

export default new DataSource({
  type: 'postgres',
  ...(databaseUrl
    ? { url: databaseUrl }
    : {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5433),
        username: process.env.POSTGRES_USER ?? 'research',
        password: process.env.POSTGRES_PASSWORD ?? 'research',
        database: process.env.POSTGRES_DB ?? 'research_memory',
      }),
  entities: [ShortTermMemory, LongTermMemory, ResearchRun],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});

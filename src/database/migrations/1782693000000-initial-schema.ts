import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1782693000000 implements MigrationInterface {
  name = 'InitialSchema1782693000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "short_term_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" character varying NOT NULL,
        "question" text NOT NULL,
        "report" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_short_term_memory" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_short_term_session_created"
      ON "short_term_memory" ("sessionId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "long_term_memory" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "fact" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_long_term_memory" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_long_term_user_updated"
      ON "long_term_memory" ("userId", "updatedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "research_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" character varying NOT NULL,
        "userId" character varying(128),
        "question" text NOT NULL,
        "status" character varying NOT NULL DEFAULT 'queued',
        "phase" character varying NOT NULL DEFAULT 'queued',
        "progress" integer NOT NULL DEFAULT 0,
        "iterations" integer NOT NULL DEFAULT 0,
        "evidenceCount" integer NOT NULL DEFAULT 0,
        "citationsUsed" integer NOT NULL DEFAULT 0,
        "executedQueries" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "report" text,
        "error" text,
        "checkpoint" jsonb,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "durationMs" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_research_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "research_runs"
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "durationMs" integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_research_status_updated"
      ON "research_runs" ("status", "updatedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_research_session_created"
      ON "research_runs" ("sessionId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "research_runs"');
    await queryRunner.query('DROP TABLE IF EXISTS "long_term_memory"');
    await queryRunner.query('DROP TABLE IF EXISTS "short_term_memory"');
  }
}

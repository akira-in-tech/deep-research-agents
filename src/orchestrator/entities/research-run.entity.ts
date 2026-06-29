import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('research_runs')
@Index(['status', 'updatedAt'])
@Index(['sessionId', 'createdAt'])
export class ResearchRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  userId!: string | null;

  @Column('text')
  question!: string;

  @Column({ default: 'queued' })
  status!: string;

  @Column({ default: 'queued' })
  phase!: string;

  @Column({ default: 0 })
  progress!: number;

  @Column({ default: 0 })
  iterations!: number;

  @Column({ default: 0 })
  evidenceCount!: number;

  @Column({ default: 0 })
  citationsUsed!: number;

  @Column('jsonb', { default: () => "'[]'::jsonb" })
  executedQueries!: string[];

  @Column('text', { nullable: true })
  report!: string | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('jsonb', { nullable: true })
  checkpoint!: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'integer', nullable: true })
  durationMs!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

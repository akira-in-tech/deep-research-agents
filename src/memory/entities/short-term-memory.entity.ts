import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Short-term memory: stores the conversation turns within a single session.
 * Each row is one research question + its report, tied to a sessionId.
 * This lets follow-up questions in the same session see prior context.
 */
@Entity('short_term_memory')
@Index(['sessionId', 'createdAt'])
export class ShortTermMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  sessionId!: string;

  @Column('text')
  question!: string;

  @Column('text')
  report!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

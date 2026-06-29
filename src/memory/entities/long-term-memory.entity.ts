import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Long-term memory: stores durable facts/preferences about a user,
 * carried across sessions. e.g. "user works in fintech", "prefers concise reports".
 */
@Entity('long_term_memory')
@Index(['userId', 'updatedAt'])
export class LongTermMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column('text')
  fact!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

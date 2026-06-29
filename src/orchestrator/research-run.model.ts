import { Field, GraphQLISODateTime, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ResearchRunView {
  @Field()
  id!: string;

  @Field()
  sessionId!: string;

  @Field(() => String, { nullable: true })
  userId!: string | null;

  @Field()
  question!: string;

  @Field()
  status!: string;

  @Field()
  phase!: string;

  @Field(() => Int)
  progress!: number;

  @Field(() => Int)
  iterations!: number;

  @Field(() => Int)
  evidenceCount!: number;

  @Field(() => Int)
  citationsUsed!: number;

  @Field(() => [String])
  executedQueries!: string[];

  @Field(() => String, { nullable: true })
  report!: string | null;

  @Field(() => String, { nullable: true })
  error!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  startedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt!: Date | null;

  @Field(() => Int, { nullable: true })
  durationMs!: number | null;
}

@ObjectType()
export class ResearchSystemMetrics {
  @Field(() => Int)
  totalRuns!: number;

  @Field(() => Int)
  runningRuns!: number;

  @Field(() => Int)
  completedRuns!: number;

  @Field(() => Int)
  failedRuns!: number;

  @Field(() => Int)
  averageDurationMs!: number;
}

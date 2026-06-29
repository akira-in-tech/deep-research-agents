import { ObjectType, Field, Int } from '@nestjs/graphql';

/**
 * The GraphQL output type for a research request.
 * Each @Field becomes a queryable field in the GraphQL schema.
 */
@ObjectType()
export class ResearchReport {
  @Field()
  sessionId!: string;

  @Field(() => String, { nullable: true })
  userId!: string | null;

  @Field()
  route!: string;

  @Field()
  report!: string;

  @Field(() => Int)
  iterations!: number;

  @Field(() => Int)
  evidenceCount!: number;

  @Field(() => Int)
  webEvidenceCount!: number;

  @Field(() => Int)
  localEvidenceCount!: number;

  @Field(() => [String])
  executedQueries!: string[];

  @Field(() => Int)
  citationsUsed!: number;
}

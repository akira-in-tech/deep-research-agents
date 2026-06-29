import { Field, Float, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class LongTermMemoryRecord {
  @Field()
  id!: string;

  @Field()
  userId!: string;

  @Field()
  fact!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => Boolean, { nullable: true })
  semanticIndexed?: boolean;
}

@ObjectType()
export class SemanticMemoryResult {
  @Field()
  id!: string;

  @Field()
  userId!: string;

  @Field()
  text!: string;

  @Field(() => Float)
  score!: number;
}

// deno-lint-ignore-file no-explicit-any
import {
  Document,
  Filter,
  IntegerType,
  MatchKeysAndValues,
  NumericType,
  SetFields,
  Timestamp,
  UpdateOptions,
  UpdateResult,
} from "mongodb";
import { BaseQuery } from "./base.ts";
import { MongoDocument, MongoModel } from "../model.ts";

export type OnlyFieldsOfType<
  TSchema,
  FieldType = any,
  AssignableType = FieldType
> = {
  [Key in keyof TSchema as TSchema[Key] extends FieldType
    ? Key
    : never]: AssignableType;
};

export type UpdateFilter<TSchema> = {
  $currentDate?: Partial<
    OnlyFieldsOfType<
      TSchema,
      Date | Timestamp,
      | true
      | {
          $type: "date" | "timestamp";
        }
    >
  >;
  $inc?: Partial<OnlyFieldsOfType<TSchema, number | NumericType | undefined>>;
  $min?: MatchKeysAndValues<TSchema>;
  $max?: MatchKeysAndValues<TSchema>;
  $mul?: Partial<OnlyFieldsOfType<TSchema, number | NumericType | undefined>>;
  $rename?: Partial<{ [K in keyof TSchema]: string }>;
  $set?: MatchKeysAndValues<TSchema>;
  $setOnInsert?: MatchKeysAndValues<TSchema>;
  $unset?: Partial<OnlyFieldsOfType<TSchema, any, "" | true | 1>>;
  $addToSet?: SetFields<TSchema>;
  $pop?: Partial<OnlyFieldsOfType<TSchema, Array<any> | undefined, 1 | -1>>;
  $pull?: Partial<OnlyFieldsOfType<TSchema, Array<any> | undefined, any>>;
  $push?: Partial<OnlyFieldsOfType<TSchema, Array<any> | undefined, any>>;
  $pullAll?: Partial<OnlyFieldsOfType<TSchema, Array<any> | undefined, any>>;
  $bit?: Partial<
    OnlyFieldsOfType<
      TSchema,
      number | NumericType | undefined,
      | {
          and: IntegerType;
        }
      | {
          or: IntegerType;
        }
      | {
          xor: IntegerType;
        }
    >
  >;
} & Document;

export class BaseUpdateQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<MongoDocument<Shape>>
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};
  protected Updates: UpdateFilter<MongoDocument<Shape>> = {};

  constructor(protected Model: Model) {
    super();
  }

  public filter(filter: Filter<MongoDocument<Shape>>) {
    this.Filters = filter;
    return this;
  }

  public updates(
    updates: UpdateFilter<MongoDocument<Shape>> & Partial<MongoDocument<Shape>>
  ) {
    if (typeof updates === "object") {
      this.Updates = { ...this.Updates };

      for (const [Key, Value] of Object.entries(updates)) {
        if (/^\$.*/.test(Key))
          this.Updates[Key] = { ...this.Updates[Key], ...Value };
        else
          this.Updates = {
            ...this.Updates,
            $set: {
              ...this.Updates.$set!,
              [Key]: Value,
            },
          };
      }
    }

    return this;
  }

  public set(set: UpdateFilter<MongoDocument<Shape>>["$set"]) {
    this.Updates = {
      ...this.Updates,
      $set: { ...this.Updates?.$set!, ...set },
    };

    return this;
  }
}

export class UpdateOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<MongoDocument<Shape>>
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });

    this.Model["log"]("updateOne", this.Filters, this.Updates, this.Options);

    const Result = (await this.Model.collection.updateOne(
      this.Filters,
      this.Updates,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        data: Result as any,
      });

    return Result;
  }

  constructor(protected Model: Model, protected Options?: UpdateOptions) {
    super(Model);
  }
}

export class UpdateManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<MongoDocument<Shape>>
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });

    this.Model["log"]("updateMany", this.Filters, this.Updates, this.Options);

    const Result = (await this.Model.collection.updateMany(
      this.Filters,
      this.Updates as any,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        data: Result as any,
      });

    return Result;
  }

  constructor(protected Model: Model, protected Options?: UpdateOptions) {
    super(Model);
  }
}

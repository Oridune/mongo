// deno-lint-ignore-file no-explicit-any ban-types
import { AggregateOptions, Filter } from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoDocument, MongoModel } from "../model.ts";
import { Flatten } from "../utility.ts";
import { Mongo } from "../mongo.ts";

export type MakeFieldsRequired<T, K extends keyof T> = {
  [P in K]-?: T[P];
} & {
  [P in Exclude<keyof T, K>]: T[P];
};

export type PopulatedDocument<Doc, Field extends string, Value> = {
  [K in keyof Doc]: K extends Field ? Value : Doc[K];
};

export class BaseFindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = MongoDocument<Shape>[]
> extends BaseQuery<Result> {
  protected Aggregation: Record<string, any>[] = [];

  constructor(protected Model: Model) {
    super();
  }

  public search(search: string) {
    this.Aggregation.push({ $text: { $search: search } });
    return this;
  }

  public filter(filter: Filter<MongoDocument<Shape>>) {
    this.Aggregation.push({
      $match: filter,
    });

    return this;
  }

  public skip(skip: number) {
    this.Aggregation.push({
      $skip: skip,
    });

    return this;
  }

  public limit(limit: number) {
    this.Aggregation.push({
      $limit: limit,
    });

    return this;
  }

  public sort(
    sort: Partial<Record<keyof Flatten<Shape> | (string & {}), 1 | -1>>
  ) {
    if (typeof sort === "object" && Object.keys(sort).length)
      this.Aggregation.push({
        $sort: sort,
      });

    return this;
  }

  public project(
    project: Partial<
      Record<keyof Shape | keyof Flatten<Shape> | (string & {}), 1 | -1>
    >
  ) {
    if (typeof project === "object" && Object.keys(project).length)
      this.Aggregation.push({
        $project: project,
      });

    return this;
  }

  public populate<
    F extends string,
    M extends MongoModel<any, any, any>,
    S = M extends MongoModel<any, any, infer R> ? R : never
  >(field: F, model: M, foreignField = "_id") {
    this.Aggregation.push({
      $lookup: {
        from: model.Name,
        localField: field,
        foreignField: foreignField,
        as: field,
      },
    });

    return this as unknown as BaseFindQuery<
      Model,
      Shape,
      Result extends Array<infer R>
        ? PopulatedDocument<R, F, S[]>[]
        : PopulatedDocument<Result, F, S[]>
    >;
  }

  public populateOne<
    F extends string,
    M extends MongoModel<any, any, any>,
    S = M extends MongoModel<any, any, infer R> ? R : never
  >(field: F, model: M, foreignField = "_id") {
    this.Aggregation.push(
      {
        $lookup: {
          from: model.Name,
          localField: field,
          foreignField: foreignField,
          as: field,
        },
      },
      {
        $unwind: {
          path: `$${field}`,
          preserveNullAndEmptyArrays: true,
        },
      }
    );

    return this as unknown as BaseFindQuery<
      Model,
      Shape,
      Result extends Array<infer R>
        ? PopulatedDocument<R, F, S>[]
        : PopulatedDocument<Result, F, S>
    >;
  }
}

export class FindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result extends any[] = MongoDocument<Shape>[]
> extends BaseFindQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].read ?? [])
      await Hook({
        event: "read",
        method: "find",
        aggregationPipeline: this.Aggregation,
      });

    this.Model["log"]("find", this.Aggregation, this.Options);

    const Result = await Mongo.useCaching(
      () =>
        this.Model.collection
          .aggregate(this.Aggregation, this.Options)
          .toArray() as Promise<Result>,
      this.Options?.cache
    );

    return Promise.all(
      Result.map(
        (doc) =>
          this.Model["PostHooks"].read?.reduce<Promise<MongoDocument<Shape>>>(
            async (doc, hook) =>
              hook({ event: "read", method: "find", data: await doc }) as any,
            Promise.resolve(doc)
          ) ?? doc
      )
    ) as Promise<Result>;
  }

  constructor(
    protected Model: Model,
    protected Options?: AggregateOptions & {
      cache?: { key: string; ttl: number };
    }
  ) {
    super(Model);
  }
}

export class FindOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = MongoDocument<Shape> | null
> extends BaseFindQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    this.Aggregation.push({ $limit: 1 });

    for (const Hook of this.Model["PreHooks"].read ?? [])
      await Hook({
        event: "read",
        method: "findOne",
        aggregationPipeline: this.Aggregation,
      });

    this.Model["log"]("findOne", this.Aggregation, this.Options);

    const Result = await Mongo.useCaching(
      () =>
        this.Model.collection
          .aggregate(this.Aggregation, this.Options)
          .toArray() as Promise<MongoDocument<Shape>[]>,
      this.Options?.cache
    );

    return (
      await Promise.all(
        Result.map(
          (doc) =>
            this.Model["PostHooks"].read?.reduce<Promise<MongoDocument<Shape>>>(
              async (doc, hook) =>
                hook({
                  event: "read",
                  method: "findOne",
                  data: await doc,
                }) as any,
              Promise.resolve(doc)
            ) ?? doc
        )
      )
    )[0] as Result;
  }

  constructor(
    protected Model: Model,
    protected Options?: AggregateOptions & {
      cache?: { key: string; ttl: number };
    }
  ) {
    super(Model);
  }
}

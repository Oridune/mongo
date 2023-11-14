// deno-lint-ignore-file no-explicit-any ban-types
import { AggregateOptions, Filter } from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoModel } from "../model.ts";
import { FlattenObject, InputDocument, OutputDocument } from "../utility.ts";
import { Mongo } from "../mongo.ts";

export type Sorting<T> = Partial<
  Record<"_id" | keyof FlattenObject<T>, 1 | -1 | (number & {})>
> & {
  [K: string]: number;
};

export type Projection<T> = Partial<
  Record<"_id" | keyof T | keyof FlattenObject<T> | (string & {}), 1 | 0>
>;

export type PopulatedDocument<Doc, Field extends string, Value> = {
  [K in keyof Doc]: K extends Field ? Value : Doc[K];
};

export type PopulateOptions<
  M extends MongoModel<any, any, any>,
  I = M extends MongoModel<any, infer R, any> ? R : never
> = {
  foreignField?: string;
  filter?: Filter<InputDocument<I>>;
  sort?: Sorting<I>;
  skip?: number;
  limit?: number;
  project?: Projection<I>;
  having?: Filter<InputDocument<I>>;
};

export class BaseFindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[]
> extends BaseQuery<Result> {
  protected Aggregation: Record<string, any>[] = [];

  protected createPopulateAggregation(
    field: string,
    model: MongoModel<any, any, any>,
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    }
  ): any[] {
    const SubPopulateConfig = model["PopulateConfig"];

    return [
      {
        $lookup: {
          from: model.Name,
          localField: field,
          foreignField: options?.foreignField ?? "_id",
          as: field,
          ...(typeof SubPopulateConfig === "object"
            ? {
                pipeline: (() => {
                  const Pipeline = this.createPopulateAggregation(
                    SubPopulateConfig.field,
                    SubPopulateConfig.model,
                    SubPopulateConfig.options
                  );

                  if (typeof options?.filter === "object")
                    Pipeline.push({ $match: options.filter });

                  if (typeof options?.sort === "object")
                    Pipeline.push({ $sort: options.sort });

                  if (typeof options?.project === "object")
                    Pipeline.push({ $project: options.project });

                  if (typeof options?.skip === "number")
                    Pipeline.push({ $skip: options.skip });

                  if (typeof options?.limit === "number")
                    Pipeline.push({ $limit: options.limit });

                  if (typeof options?.having === "object")
                    Pipeline.push({ $match: options.having });

                  return Pipeline;
                })(),
              }
            : {}),
        },
      },
      ...(options?.unwind
        ? [
            {
              $unwind: {
                path: `$${field}`,
                preserveNullAndEmptyArrays: true,
              },
            },
          ]
        : []),
    ];
  }

  constructor(protected Model: Model) {
    super();
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    this.Aggregation.push({ $match: filter });
    return this;
  }

  public sort(sort: Sorting<Shape>) {
    if (typeof sort === "object" && Object.keys(sort).length)
      this.Aggregation.push({ $sort: sort });

    return this;
  }

  public project(project: Projection<Shape>) {
    if (typeof project === "object" && Object.keys(project).length)
      this.Aggregation.push({ $project: project });

    return this;
  }

  public skip(skip: number) {
    this.Aggregation.push({ $skip: skip });
    return this;
  }

  public limit(limit: number) {
    this.Aggregation.push({ $limit: limit });
    return this;
  }

  public populate<
    F extends string,
    M extends MongoModel<any, any, any>,
    S = M extends MongoModel<any, any, infer R> ? R : never
  >(field: F, model: M, options?: PopulateOptions<M>) {
    if (!(model instanceof MongoModel))
      throw new Error("Invalid population model!");

    this.Aggregation.push(
      ...this.createPopulateAggregation(field, model, options as any)
    );

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
  >(field: F, model: M, options?: PopulateOptions<M>) {
    this.Aggregation.push(
      ...this.createPopulateAggregation(field, model, {
        ...(options as any),
        unwind: true,
      })
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
  Result extends any[] = OutputDocument<Shape>[]
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
          this.Model["PostHooks"].read?.reduce<Promise<OutputDocument<Shape>>>(
            async (doc, hook) =>
              hook({ event: "read", method: "find", data: await doc }) as any,
            Promise.resolve(doc)
          ) ?? doc
      )
    ) as any;
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
  Result = OutputDocument<Shape> | null
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
          .toArray() as Promise<OutputDocument<Shape>[]>,
      this.Options?.cache
    );

    return (
      await Promise.all(
        Result.map(
          (doc) =>
            this.Model["PostHooks"].read?.reduce<
              Promise<OutputDocument<Shape>>
            >(
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

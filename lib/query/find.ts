// deno-lint-ignore-file no-explicit-any ban-types
import type { AggregateOptions, Filter } from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoModel } from "../model.ts";
import type { InputDocument, OutputDocument } from "../utility.ts";
import { Mongo, type TCacheOptions } from "../mongo.ts";

export type Sorting<T> =
  & Partial<
    Record<"_id" | keyof T, 1 | -1 | (number & {})>
  >
  & {
    [K: string]: number;
  };

export type Projection<T> =
  & Partial<
    Record<"_id" | keyof T, 1 | 0 | (number & {})>
  >
  & {
    [K: string]: number;
  };

type NestedPopulatedDocument<
  Doc,
  Field extends string,
  Value,
  SDoc = Doc extends Array<infer S> ? S : Doc,
  Result = {
    [K in keyof SDoc]: K extends Field ? Value : SDoc[K];
  },
> = Doc extends Array<any> ? Result[] : Result;

export type PopulatedDocument<
  Doc,
  Field extends string,
  Value,
  F1 = Field extends `${infer R}.${string}` ? R : Field,
  F2 = Field extends `${string}.${infer R}` ? R : false,
> = {
  [K in keyof Doc]: K extends F1
    ? F2 extends string ? undefined extends Doc[K] ?
          | NestedPopulatedDocument<Exclude<Doc[K], undefined>, F2, Value>
          | undefined
      : NestedPopulatedDocument<Doc[K], F2, Value>
    : Value
    : Doc[K];
};

export type PopulateOptions<
  M extends MongoModel<any, any, any>,
  I = M extends MongoModel<any, infer R, any> ? R : never,
> = {
  foreignField?: string;
  filter?: Filter<InputDocument<I>>;
  sort?: Sorting<I>;
  skip?: number;
  limit?: number;
  project?: Projection<I>;
  having?: Filter<InputDocument<I>>;
};

export interface BaseFindQueryOptions<Shape> {
  initialFilter?: () => Filter<InputDocument<Shape>>;
}

export class BaseFindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseQuery<Result> {
  private Aggregation: Record<string, any>[] = [];

  protected createPopulateAggregation(
    field: string,
    model: MongoModel<any, any, any>,
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    },
  ): any[] {
    const SubPopulateConfig = model["PopulateConfig"];

    const IsNestedPopulate = /\./.test(field);
    const ParentField = field.split(".")[0];

    return [
      ...(IsNestedPopulate
        ? [
          {
            $addFields: {
              [`isNull_${ParentField}`]: {
                $cond: [`$${ParentField}`, false, true],
              },
            },
          },
          {
            $addFields: {
              [`isArray_${ParentField}`]: { $isArray: `$${ParentField}` },
            },
          },
          {
            $unwind: {
              path: `$${ParentField}`,
              preserveNullAndEmptyArrays: true,
            },
          },
        ]
        : []),
      {
        $lookup: {
          from: model.Name,
          localField: field,
          foreignField: options?.foreignField ?? "_id",
          as: field,
          pipeline: (() => {
            const Pipeline = typeof SubPopulateConfig === "object"
              ? this.createPopulateAggregation(
                SubPopulateConfig.field,
                SubPopulateConfig.model,
                SubPopulateConfig.options,
              )
              : [];

            if (typeof options?.filter === "object") {
              Pipeline.push({ $match: options.filter });
            }

            if (typeof options?.sort === "object") {
              Pipeline.push({ $sort: options.sort });
            }

            if (typeof options?.project === "object") {
              Pipeline.push({ $project: options.project });
            }

            if (typeof options?.skip === "number") {
              Pipeline.push({ $skip: options.skip });
            }

            if (typeof options?.limit === "number") {
              Pipeline.push({ $limit: options.limit });
            }

            if (typeof options?.having === "object") {
              Pipeline.push({ $match: options.having });
            }

            return Pipeline;
          })(),
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
      ...(IsNestedPopulate
        ? [
          {
            $group: {
              _id: "$_id",
              [ParentField]: { $push: `$${ParentField}` },
              otherFields: { $mergeObjects: "$$ROOT" },
            },
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: [
                  "$otherFields",
                  { _id: "$_id", [ParentField]: `$${ParentField}` },
                ],
              },
            },
          },
          {
            $addFields: {
              [ParentField]: {
                $cond: [
                  { $eq: [`$isNull_${ParentField}`, true] },
                  "$$REMOVE",
                  {
                    $cond: [
                      { $eq: [`$isArray_${ParentField}`, true] },
                      `$${ParentField}`,
                      { $arrayElemAt: [`$${ParentField}`, 0] },
                    ],
                  },
                ],
              },
            },
          },
          { $unset: [`isNull_${ParentField}`, `isArray_${ParentField}`] },
        ]
        : []),
    ];
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: BaseFindQueryOptions<Shape>,
  ) {
    super();
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    if (typeof filter === "object" && Object.keys(filter).length) {
      this.Aggregation.push({ $match: filter });
    }

    return this;
  }

  public sort(sort: Sorting<Shape>) {
    if (typeof sort === "object" && Object.keys(sort).length) {
      this.Aggregation.push({ $sort: sort });
    }

    return this;
  }

  public project(project: Projection<Shape>) {
    if (typeof project === "object" && Object.keys(project).length) {
      this.Aggregation.push({ $project: project });
    }

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
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    if (!(model instanceof MongoModel)) {
      throw new Error("Invalid population model!");
    }

    this.Aggregation.push(
      ...this.createPopulateAggregation(field, model, options as any),
    );

    return this as unknown as BaseFindQuery<
      Model,
      Shape,
      Result extends Array<infer R> ? PopulatedDocument<R, F, S[]>[]
        : PopulatedDocument<Result, F, S[]>
    >;
  }

  public populateOne<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    this.Aggregation.push(
      ...this.createPopulateAggregation(field, model, {
        ...(options as any),
        unwind: true,
      }),
    );

    return this as unknown as BaseFindQuery<
      Model,
      Shape,
      Result extends Array<infer R> ? PopulatedDocument<R, F, S>[]
        : PopulatedDocument<Result, F, S>
    >;
  }

  public getPipeline() {
    if (typeof this.Options?.initialFilter === "function") {
      const InitialFilter = this.Options.initialFilter();

      if (
        typeof InitialFilter === "object" && Object.keys(InitialFilter).length
      ) {
        return [{ $match: InitialFilter }, ...this.Aggregation];
      }
    }

    return this.Aggregation;
  }
}

export class FindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseFindQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    const Aggregation = this.getPipeline();

    for (const Hook of this.DatabaseModel["PreHooks"].read ?? []) {
      await Hook({
        event: "read",
        method: "find",
        aggregationPipeline: Aggregation,
      });
    }

    this.DatabaseModel["log"]("find", Aggregation, this.Options);

    const Result = await (Mongo.useCaching(
      () =>
        this.DatabaseModel.collection
          .aggregate(Aggregation, this.Options)
          .toArray(),
      this.Options?.cache,
    ));

    return Promise.all(
      Result.map(
        (doc) =>
          this.DatabaseModel["PostHooks"].read?.reduce(
            async (doc, hook) =>
              hook({
                event: "read",
                method: "find",
                data: await doc as any,
              }) as any,
            Promise.resolve(doc),
          ) ?? doc,
      ),
    ) as any;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: AggregateOptions & BaseFindQueryOptions<Shape> & {
      cache?: TCacheOptions;
    },
  ) {
    super(DatabaseModel, Options);
  }
}

export class FindOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null,
> extends BaseFindQuery<Model, Shape, Result> {
  protected LimitApplied = false;

  protected async exec(): Promise<Result> {
    if (!this.LimitApplied) {
      this.limit(1).LimitApplied = true;
    }

    const Aggregation = this.getPipeline();

    for (const Hook of this.DatabaseModel["PreHooks"].read ?? []) {
      await Hook({
        event: "read",
        method: "findOne",
        aggregationPipeline: Aggregation,
      });
    }

    this.DatabaseModel["log"]("findOne", Aggregation, this.Options);

    const Result = await Mongo.useCaching(
      () =>
        this.DatabaseModel.collection
          .aggregate(Aggregation, this.Options)
          .toArray() as Promise<OutputDocument<Shape>[]>,
      this.Options?.cache,
    );

    if (!Result.length) {
      if (this.Options?.errorOnNull) throw new Error("Record not found!");
      else return null as Result;
    }

    return (
      await Promise.all(
        Result.map(
          (doc) =>
            this.DatabaseModel["PostHooks"].read?.reduce<
              Promise<OutputDocument<Shape>>
            >(
              async (doc, hook) =>
                hook({
                  event: "read",
                  method: "findOne",
                  data: await doc,
                }) as any,
              Promise.resolve(doc),
            ) ?? doc,
        ),
      )
    )[0] as Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: AggregateOptions & BaseFindQueryOptions<Shape> & {
      cache?: TCacheOptions;
      errorOnNull?: boolean;
    },
  ) {
    super(DatabaseModel, Options);
  }
}

// deno-lint-ignore-file no-explicit-any ban-types
import { type AggregateOptions, type Filter, ObjectId } from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoModel } from "../model.ts";
import {
  getObjectValue,
  type InputDocument,
  type OutputDocument,
  setObjectValue,
} from "../utility.ts";
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

export type FetchOptions = {
  field: string;
  model: MongoModel<any, any, any>;
  options?: PopulateOptions<MongoModel<any, any, any>>;
  singular?: boolean;
};

export interface BaseFindQueryOptions<Shape> {
  initialFilter?: () => Filter<InputDocument<Shape>>;
}

type Document = Record<string, any>;

export class BaseFindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseQuery<Result> {
  private Aggregation: Document[] = [];

  private Fetches?: Record<string, FetchOptions>;

  protected createPopulateAggregation(
    field: string,
    model: MongoModel<any, any, any>,
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    },
  ): any[] {
    const SubPopulateConfig = model["populateConfig"];

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
          from: model.name,
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

            typeof options?.filter === "object" &&
              Pipeline.push({ $match: options.filter });
            typeof options?.sort === "object" &&
              Pipeline.push({ $sort: options.sort });
            typeof options?.skip === "number" &&
              Pipeline.push({ $skip: options.skip });
            typeof options?.limit === "number" &&
              Pipeline.push({ $limit: options.limit });
            typeof options?.project === "object" &&
              Pipeline.push({ $project: options.project });
            typeof options?.having === "object" &&
              Pipeline.push({ $match: options.having });

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

  protected async fetchRelations<T extends Array<any>>(results: T) {
    if (!this.Fetches || !results.length) return results;

    const fetch = async (details: FetchOptions, ref: any) => {
      const _ref = ref instanceof Array ? ref.filter(Boolean) : ref;

      if (_ref === undefined || (_ref instanceof Array && !_ref.length)) {
        return [];
      }

      const Query = details.model.find({
        [details.options?.foreignField ?? "_id"]: _ref instanceof Array
          ? {
            $in: Array
              .from(new Set(_ref.map(String)))
              .map((_) => new ObjectId(_)),
          }
          : _ref,
      });

      typeof details.options?.filter === "object" &&
        Query.filter(details.options.filter);
      typeof details.options?.sort === "object" &&
        Query.sort(details.options.sort);
      typeof details.options?.skip === "number" &&
        Query.skip(details.options.skip);
      typeof details.options?.limit === "number" &&
        Query.limit(details.options.limit);
      typeof details.options?.project === "object" &&
        Query.project(details.options.project);
      typeof details.options?.having === "object" &&
        Query.filter(details.options.having);

      return await Query;
    };

    return await Promise.all(results.map(async (item) => {
      for (const fetchDetails of Object.values(this.Fetches!)) {
        const { plural, value } = getObjectValue(item, fetchDetails.field);

        const currentField = fetchDetails.field.split(".");

        if (plural) {
          if (!(value instanceof Array)) {
            throw new Error("Something is not right!");
          }

          const Results = await fetch(fetchDetails, value.flat());
          const resultMap = Object.groupBy(Results, ({ _id }) => String(_id));

          value.forEach((id, index) => {
            const newField = [...currentField];

            newField.splice(
              currentField.length - 1,
              0,
              index.toString(),
            );

            if (id) {
              const TargetValues = (id instanceof Array ? id : [id]).map((i) =>
                resultMap[String(i)]?.[0]
              );

              const TargetValue = fetchDetails.singular
                ? TargetValues[0]
                : TargetValues;

              if (TargetValue !== undefined) {
                setObjectValue(
                  item,
                  newField,
                  TargetValue,
                );
              }
            }
          });
        } else {
          const Results = await fetch(fetchDetails, value);

          const TargetValue = fetchDetails.singular ? Results[0] : Results;

          if (TargetValue !== undefined) {
            setObjectValue(
              item,
              currentField,
              TargetValue,
            );
          }
        }
      }

      return item;
    }));
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: BaseFindQueryOptions<Shape>,
  ) {
    super();
  }

  public custom(pipeline: Document[]) {
    if (pipeline instanceof Array && pipeline.length) {
      this.Aggregation.push(...pipeline);
    }

    return this;
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    if (typeof filter === "object" && Object.keys(filter).length) {
      this.Aggregation.push({ $match: filter });
    }

    return this;
  }

  public groupBy(
    field: string | string[],
    options?: { selectLastDoc?: boolean },
  ) {
    const fields = field instanceof Array ? field : [field];

    if (fields.length) {
      const groupKeys = fields.reduce((keys, key) => {
        keys[key] = `$${key}`;
        return keys;
      }, {} as Record<string, string>);

      this.Aggregation.push({
        $group: {
          _id: groupKeys,
          totalCount: { $sum: 1 },
          record: {
            [options?.selectLastDoc ? "$last" : "$first"]: "$$ROOT",
          },
        },
      }, {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$record",
              groupKeys,
              {
                totalCount: "$totalCount",
              },
            ],
          },
        },
      });
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

    if (this.DatabaseModel.connectionIndex !== model.connectionIndex) {
      throw new Error("Cannot populate from another connection!");
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
    if (!(model instanceof MongoModel)) {
      throw new Error("Invalid population model!");
    }

    if (this.DatabaseModel.connectionIndex !== model.connectionIndex) {
      throw new Error("Cannot populate from another connection!");
    }

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

  public fetch<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    if (!(model instanceof MongoModel)) {
      throw new Error("Invalid population model!");
    }

    (this.Fetches ??= {})[field] = {
      field,
      model,
      options,
    };

    return this as unknown as BaseFindQuery<
      Model,
      Shape,
      Result extends Array<infer R> ? PopulatedDocument<R, F, S[]>[]
        : PopulatedDocument<Result, F, S[]>
    >;
  }

  public fetchOne<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    if (!(model instanceof MongoModel)) {
      throw new Error("Invalid population model!");
    }

    (this.Fetches ??= {})[field] = {
      field,
      model,
      options,
      singular: true,
    };

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
      ) return [{ $match: InitialFilter }, ...this.Aggregation];
    }

    return this.Aggregation;
  }
}

export class FindQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseFindQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    const Aggregation = this.getPipeline();

    for (const Hook of this.DatabaseModel["PreHooks"].read ?? []) {
      await Hook({
        event: "read",
        method: "find",
        aggregationPipeline: Aggregation,
      });
    }

    this.DatabaseModel["log"]("find", Aggregation, this.Options);

    let Results = await (Mongo.useCaching(
      async () => {
        const cursor = this.DatabaseModel.collection
          .aggregate(Aggregation, this.Options);

        const results = await this.fetchRelations(
          await cursor.toArray(),
        );

        await cursor.close();

        return results;
      },
      this.Options?.cache,
    ));

    if (this.DatabaseModel["PostHooks"].read?.length) {
      Results = await Promise.all(
        Results.map(
          (doc) =>
            this.DatabaseModel["PostHooks"].read!.reduce(
              async (doc, hook) =>
                hook({
                  event: "read",
                  method: "find",
                  data: await doc as any,
                }) as any,
              Promise.resolve(doc),
            ) ?? doc,
        ),
      );
    }

    return Results as Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected override Options?:
      & AggregateOptions
      & BaseFindQueryOptions<Shape>
      & {
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

  protected override async exec(): Promise<Result> {
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

    const Results = await Mongo.useCaching(
      async () => {
        const cursor = this.DatabaseModel.collection
          .aggregate(Aggregation, this.Options);

        const results = await this.fetchRelations(
          await cursor.toArray(),
        );

        await cursor.close();

        return results;
      },
      this.Options?.cache,
    );

    if (!Results.length) {
      if (this.Options?.errorOnNull) throw new Error("Record not found!");
      else return null as Result;
    }

    let Result = Results[0] as Result;

    if (this.DatabaseModel["PostHooks"].read?.length) {
      Result = (
        await Promise.all(
          Results.map(
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

    return Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected override Options?:
      & AggregateOptions
      & BaseFindQueryOptions<Shape>
      & {
        cache?: TCacheOptions;
        errorOnNull?: boolean;
      },
  ) {
    super(DatabaseModel, Options);
  }
}

export class CountQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = number,
> extends BaseFindQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    this.custom([{ $count: "count" }]);

    const Aggregation = this.getPipeline();

    for (const Hook of this.DatabaseModel["PreHooks"].read ?? []) {
      await Hook({
        event: "read",
        method: "count",
        aggregationPipeline: Aggregation,
      });
    }

    this.DatabaseModel["log"]("count", Aggregation, this.Options);

    let Results = await (Mongo.useCaching(
      async () => {
        const cursor = this.DatabaseModel.collection
          .aggregate(Aggregation, this.Options);

        const results = await this.fetchRelations(
          await cursor.toArray(),
        );

        await cursor.close();

        return results;
      },
      this.Options?.cache,
    ));

    if (this.DatabaseModel["PostHooks"].read?.length) {
      Results = await Promise.all(
        Results.map(
          (doc) =>
            this.DatabaseModel["PostHooks"].read!.reduce(
              async (doc, hook) =>
                hook({
                  event: "read",
                  method: "count",
                  data: await doc as any,
                }) as any,
              Promise.resolve(doc),
            ) ?? doc,
        ),
      );
    }

    return (Results[0]?.count ?? 0) as Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected override Options?:
      & AggregateOptions
      & BaseFindQueryOptions<Shape>
      & {
        cache?: TCacheOptions;
      },
  ) {
    super(DatabaseModel, Options);
  }
}

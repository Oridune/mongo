// deno-lint-ignore-file no-explicit-any
import e, {
  ObjectValidator,
  ArrayValidator,
  inferInput,
  inferOutput,
} from "../validator.ts";
import {
  Db,
  CollectionOptions,
  ObjectId,
  InsertOneOptions,
  BulkWriteOptions,
  ReplaceOptions,
  Filter,
  CreateIndexesOptions,
  IndexDirection,
  AggregateOptions,
  UpdateOptions,
  DeleteOptions,
  ClientSession,
  UpdateResult,
  CountDocumentsOptions,
  ChangeStreamOptions,
  highligthEs,
  UpdateFilter,
  CommandOperationOptions,
} from "../deps.ts";
import { Mongo, TCacheOptions } from "./mongo.ts";
import { MongoHooks } from "./hooks.ts";
import { InputDocument, OutputDocument, circularReplacer } from "./utility.ts";
import {
  FindQuery,
  FindOneQuery,
  PopulateOptions,
  PopulatedDocument,
} from "./query/find.ts";
import { UpdateOneQuery, UpdateManyQuery } from "./query/update.ts";
import { DeleteManyQuery, DeleteOneQuery } from "./query/delete.ts";
import {
  FindAndDeleteManyQuery,
  FindAndDeleteOneQuery,
  FindAndUpdateManyQuery,
  FindAndUpdateOneQuery,
  UpdateAndFindManyQuery,
  UpdateAndFindOneQuery,
} from "./query/utility.ts";

export interface ModelOptions {
  database?: string;
  collectionOptions?: CollectionOptions;
  logs?: boolean;
  invalidateFields?: string[];
}

export class MongoModel<
  Schema extends ObjectValidator<any, any, any>,
  InputShape extends object = inferInput<Schema>,
  OutputShape extends object = inferOutput<Schema>
> extends MongoHooks<InputShape, OutputShape> {
  protected DatabaseInstance?: Db;
  protected PopulateConfig?: {
    field: string;
    model: MongoModel<any, any, any>;
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    };
  };

  protected log(method: string, ...args: any[]) {
    if (this.Options.logs || Mongo.enableLogs)
      console.info(
        "Query Executed::",
        highligthEs(
          `${this.database.databaseName}.${this.Name}.${method}(\n\r\t${args
            .map((arg) => {
              const Arg = { ...arg };

              if (Arg.session instanceof ClientSession)
                Arg.session = `new ClientSession(${(
                  Arg.session as ClientSession
                ).id?.id.toUUID()})`;

              return Arg
                ? JSON.stringify(Arg, circularReplacer(), 1)
                : undefined;
            })
            .filter(Boolean)
            .join(",\n\r\t")}\n\r);`
        )
      );
  }

  public getSchema() {
    const Schema =
      typeof this.ModelSchema === "function"
        ? this.ModelSchema()
        : this.ModelSchema;

    if (!(Schema instanceof ObjectValidator))
      throw new Error(`Invalid or unexpected schema passed!`);

    return e.deepCast(Schema, {
      eachValidatorOptions: (validator) => {
        if (validator instanceof ArrayValidator)
          return { ignoreNanKeys: true, pushNanKeys: true };
      },
    });
  }

  public getUpdateSchema() {
    return this.getSchema();
  }

  constructor(
    public Name: string,
    public ModelSchema: Schema | (() => Schema),
    public Options: ModelOptions = {}
  ) {
    super();
  }

  get database() {
    if (!Mongo.client || !Mongo.isConnected())
      throw new Error(`Please connect to the database!`);

    return (this.DatabaseInstance ??= Mongo.client.db(this.Options.database));
  }

  get collection() {
    return this.database.collection(this.Name, this.Options.collectionOptions);
  }

  public createIndex(
    ...indexDesc: (CreateIndexesOptions & {
      key: Partial<Record<string, IndexDirection>>;
      partialFilterExpression?: Filter<InputDocument<InputShape>>;
    })[]
  ) {
    Mongo.post("connect", async () => {
      this.log("createIndex", ...indexDesc);

      if (indexDesc.length)
        await this.collection
          .createIndexes(indexDesc as any)
          .catch(console.error);
    });

    return this;
  }

  public dropIndex(indexNames: string[], options?: CommandOperationOptions) {
    Mongo.post("connect", async () => {
      for (const Name of indexNames)
        await this.collection.dropIndex(Name, options);
    });

    return this;
  }

  public async create(
    doc: InputDocument<InputShape>,
    options?: InsertOneOptions & { validate?: boolean }
  ): Promise<OutputDocument<OutputShape>> {
    doc =
      (await this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(doc)
      )) ?? doc;

    this.log("create", doc, options);

    const Doc =
      options?.validate === false
        ? doc
        : await this.getSchema().validate(doc, {
            name: this.Name,
          });

    const Ack = await this.collection.insertOne(Doc, options);
    const Result = { _id: Ack.insertedId, ...Doc };

    return (
      this.PostHooks.create?.reduce<Promise<OutputDocument<OutputShape>>>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(Result)
      ) ?? Result
    );
  }

  public async createMany(
    docs: InputDocument<InputShape>[],
    options?: BulkWriteOptions & { validate?: boolean }
  ): Promise<OutputDocument<OutputShape>[]> {
    docs = await Promise.all(
      docs.map(
        (doc) =>
          this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
            async (doc, hook) =>
              hook({ event: "create", method: "createMany", data: await doc }),
            Promise.resolve(doc)
          ) ?? doc
      )
    );

    this.log("createMany", docs, options);

    const Docs =
      options?.validate === false
        ? docs
        : await e.array(this.getSchema()).validate(docs, {
            name: this.Name,
          });

    const Ack = await this.collection.insertMany(Docs, options);

    return Promise.all(
      Docs.map((doc, index) => ({
        _id: Ack.insertedIds[index],
        ...(doc as any),
      })).map(
        (doc) =>
          this.PostHooks.create?.reduce<Promise<OutputDocument<OutputShape>>>(
            async (doc, hook) =>
              hook({ event: "create", method: "createMany", data: await doc }),
            Promise.resolve(doc)
          ) ?? doc
      )
    ) as any;
  }

  public find(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: TCacheOptions }
  ) {
    return new FindQuery(this, options).filter(filter as any);
  }

  public search(
    searchTerm?:
      | string
      | {
          $search: string;
          $language?: string;
          $caseSensitive?: boolean;
          $diacriticSensitive?: boolean;
        },
    options?: AggregateOptions & { cache?: TCacheOptions }
  ) {
    return new FindQuery(this, options).filter({
      ...(searchTerm
        ? {
            $text:
              typeof searchTerm === "object"
                ? searchTerm
                : { $search: searchTerm },
          }
        : {}),
    });
  }

  public findOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: TCacheOptions }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindOneQuery(this, options).filter(Filter);
  }

  public findOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: TCacheOptions }
  ) {
    const Query = this.findOne(filter, {
      ...options,
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      errorOnNull: true,
    });

    type UnnulledFindOneQuery<T> = T extends FindOneQuery<
      infer M,
      infer S,
      infer R
    >
      ? FindOneQuery<M, S, Exclude<R, null>>
      : never;

    return Query as UnnulledFindOneQuery<typeof Query>;
  }

  public count(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: CountDocumentsOptions & { cache?: TCacheOptions }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("count", Filter, options);
    return Mongo.useCaching(
      () => this.collection.countDocuments(Filter, options),
      options?.cache
    );
  }

  public async exists(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: CountDocumentsOptions & { cache?: TCacheOptions }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("exists", Filter, options);
    return !!(await Mongo.useCaching(
      () => this.collection.countDocuments(Filter, options),
      options?.cache
    ));
  }

  public watch(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: ChangeStreamOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("watch", Filter, options);
    return this.collection.watch<OutputDocument<OutputShape>>(
      [{ $match: Filter }],
      options
    );
  }

  public updateOne<F = InputDocument<InputShape>>(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new UpdateOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public async updateOneOrFail<F = InputDocument<InputShape>>(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    const Result = await this.updateOne<F>(filter, updates, options);

    if (!Result.modifiedCount)
      throw new Error("Record update has been failed!");

    return Result;
  }

  public updateAndFindOne<F = InputDocument<InputShape>>(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new UpdateAndFindOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public findAndUpdateOne<F = InputDocument<InputShape>>(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindAndUpdateOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public updateMany<F = InputDocument<InputShape>>(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    return new UpdateManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public async updateManyOrFail<F = InputDocument<InputShape>>(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    const Result = await this.updateMany<F>(filter, updates, options);

    if (!Result.modifiedCount)
      throw new Error("Record update has been failed!");

    return Result;
  }

  public updateAndFindMany<F = InputDocument<InputShape>>(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    return new UpdateAndFindManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public findAndUpdateMany<F = InputDocument<InputShape>>(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<F> & Partial<F>,
    options?: UpdateOptions & { validate?: boolean }
  ) {
    return new FindAndUpdateManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public deleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new DeleteOneQuery(this, options).filter(Filter);
  }

  public async deleteOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    const Result = await this.deleteOne(filter, options);

    if (!Result.deletedCount)
      throw new Error("Record deletion has been failed!");

    return Result;
  }

  public findAndDeleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindAndDeleteOneQuery(this, options).filter(Filter);
  }

  public deleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    return new DeleteManyQuery(this, options).filter(filter as any);
  }

  public async deleteManyOrFail(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    const Result = await this.deleteMany(filter, options);

    if (!Result.deletedCount)
      throw new Error("Record deletion has been failed!");

    return Result;
  }

  public findAndDeleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    return new FindAndDeleteManyQuery(this, options).filter(filter as any);
  }

  public async replaceOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    doc: InputDocument<InputShape>,
    options?: ReplaceOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    doc =
      (await this.PreHooks.replace?.reduce<Promise<InputDocument<InputShape>>>(
        async (doc, hook) =>
          hook({
            event: "replace",
            method: "replaceOne",
            filter: Filter,
            replacement: await doc,
          }),
        Promise.resolve(doc)
      )) ?? doc;

    this.log("replaceOne", Filter, doc, options);

    const Doc = await this.getSchema().validate(doc, {
      name: this.Name,
    });

    const Result = (await this.collection.replaceOne(Filter, Doc, options)) as
      | InputDocument<InputShape>
      | UpdateResult<InputDocument<InputShape>>;

    for (const Hook of this.PostHooks.replace ?? [])
      await Hook({
        event: "replace",
        method: "replaceOne",
        data: Result,
      });

    return Result;
  }

  public populate<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>
  >(field: F, model: M, options?: PopulateOptions<M>) {
    const Model = new (this["constructor"] as typeof MongoModel)(
      this.Name,
      this.ModelSchema,
      this.Options
    );

    Model["PopulateConfig"] = {
      field,
      model,
      options: options as any,
    };

    return Model as MongoModel<
      Schema,
      InputShape,
      PopulatedDocument<OutputShape, F, S[]>
    >;
  }

  public populateOne<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>
  >(field: F, model: M, options?: PopulateOptions<M>) {
    const Model = new (this["constructor"] as typeof MongoModel)(
      this.Name,
      this.ModelSchema,
      this.Options
    );

    Model["PopulateConfig"] = {
      field,
      model,
      options: {
        ...(options as any),
        unwind: true,
      },
    };

    return Model as MongoModel<
      Schema,
      InputShape,
      PopulatedDocument<OutputShape, F, S>
    >;
  }
}

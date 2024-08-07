// deno-lint-ignore-file no-explicit-any
import e, {
  type inferInput,
  type inferOutput,
  ObjectValidator,
} from "../validator.ts";
import {
  type AggregateOptions,
  type BulkWriteOptions,
  type ChangeStreamOptions,
  ClientSession,
  type CollectionOptions,
  type CommandOperationOptions,
  type CountDocumentsOptions,
  type CreateIndexesOptions,
  type Db,
  type DeleteOptions,
  type Filter,
  highligthEs,
  type IndexDirection,
  type InsertOneOptions,
  ObjectId,
  type ReplaceOptions,
  type UpdateFilter,
  type UpdateOptions,
  type UpdateResult,
} from "../deps.ts";
import { Mongo, type TCacheOptions } from "./mongo.ts";
import { MongoHooks } from "./hooks.ts";
import {
  circularReplacer,
  type InputDocument,
  type OutputDocument,
} from "./utility.ts";
import {
  FindOneQuery,
  FindQuery,
  type PopulatedDocument,
  type PopulateOptions,
} from "./query/find.ts";
import { UpdateManyQuery, UpdateOneQuery } from "./query/update.ts";
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
  connectionIndex?: number;
  database?: string;
  collectionOptions?: CollectionOptions;
  logs?: boolean;
  invalidateFields?: string[];
}

export class MongoModel<
  Schema extends ObjectValidator<any, any, any>,
  InputShape extends object = inferInput<Schema>,
  OutputShape extends object = inferOutput<Schema>,
> extends MongoHooks<InputShape, OutputShape> {
  protected databaseInstance?: Db;
  protected populateConfig?: {
    field: string;
    model: MongoModel<any, any, any>;
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    };
  };

  protected log(method: string, ...args: any[]) {
    if (this.options.logs || Mongo.enableLogs) {
      console.info(
        "Query Executed::",
        highligthEs(
          `@${this.connectionIndex}.${this.database.databaseName}.${this.name}.${method}(\n\r\t${
            args
              .map((arg) => {
                const Arg = { ...arg };

                if (Arg.session instanceof ClientSession) {
                  Arg.session = `new ClientSession(${
                    (
                      Arg.session as ClientSession
                    ).id?.id.toUUID()
                  }) @${Arg.session._connectionIndex ?? this.connectionIndex}`;
                }

                return Arg
                  ? JSON.stringify(Arg, circularReplacer(), 1)
                  : undefined;
              })
              .filter(Boolean)
              .join(",\n\r\t")
          }\n\r);`,
        ),
      );
    }
  }

  public getSchema() {
    const Schema = typeof this.schema === "function"
      ? this.schema()
      : this.schema;

    if (!(Schema instanceof ObjectValidator)) {
      throw new Error(`Invalid or unexpected schema passed!`);
    }

    return e.deepCast(Schema);
  }

  public getUpdateSchema() {
    return this.getSchema();
  }

  public options: ModelOptions;
  public connectionIndex: number;

  constructor(
    public name: string,
    public schema: Schema | (() => Schema),
    opts?: ModelOptions | number,
  ) {
    super();

    this.options = typeof opts === "number"
      ? { connectionIndex: opts }
      : opts ?? {};

    this.connectionIndex = this.options.connectionIndex ??= 0;
  }

  get database() {
    if (!Mongo.isConnected(this.connectionIndex)) {
      throw new Error(`Please connect to the database!`);
    }

    if (
      !this.databaseInstance ||
      ("client" in this.databaseInstance &&
        this.databaseInstance.client !== Mongo.clients[this.connectionIndex]!)
    ) {
      return (this.databaseInstance = Mongo.clients[this.connectionIndex]!.db(
        this.options.database,
      ));
    }

    return this.databaseInstance;
  }

  get collection() {
    return this.database.collection(this.name, this.options.collectionOptions);
  }

  public async createIndex(
    ...indexDesc: (CreateIndexesOptions & {
      key: Partial<Record<string, IndexDirection>>;
      partialFilterExpression?: Filter<InputDocument<InputShape>>;
    })[]
  ) {
    const createIndex = async () => {
      this.log("createIndex", ...indexDesc);

      if (indexDesc.length) {
        await this.collection
          .createIndexes(indexDesc as any)
          .catch(console.error);
      }
    };

    if (Mongo.isConnected(this.connectionIndex)) await createIndex();
    else Mongo.post("connect", createIndex);

    return this;
  }

  public async dropIndex(
    indexNames: string[],
    options?: CommandOperationOptions,
  ) {
    const dropIndex = async () => {
      for (const Name of indexNames) {
        await this.collection.dropIndex(Name, options);
      }
    };

    if (Mongo.isConnected(this.connectionIndex)) await dropIndex();
    else Mongo.post("connect", dropIndex);

    return this;
  }

  public async create(
    doc: InputDocument<InputShape>,
    options?: InsertOneOptions & { validate?: boolean },
  ): Promise<OutputDocument<OutputShape>> {
    doc =
      (await this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(doc),
      )) ?? doc;

    this.log("create", doc, options);

    const Doc = options?.validate === false
      ? doc
      : await this.getSchema().validate(doc, {
        name: this.name,
      });

    const Ack = await this.collection.insertOne(Doc, options);
    const Result = { _id: Ack.insertedId, ...Doc };

    return (
      this.PostHooks.create?.reduce<any>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(Result),
      ) ?? Result
    );
  }

  public async createMany(
    docs: InputDocument<InputShape>[],
    options?: BulkWriteOptions & { validate?: boolean },
  ): Promise<OutputDocument<OutputShape>[]> {
    docs = await Promise.all(
      docs.map(
        (doc) =>
          this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
            async (doc, hook) =>
              hook({ event: "create", method: "createMany", data: await doc }),
            Promise.resolve(doc),
          ) ?? doc,
      ),
    );

    this.log("createMany", docs, options);

    const Docs = options?.validate === false
      ? docs
      : await e.array(this.getSchema()).validate(docs, {
        name: this.name,
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
            Promise.resolve(doc),
          ) ?? doc,
      ),
    ) as any;
  }

  public find(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: TCacheOptions },
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
    options?: AggregateOptions & { cache?: TCacheOptions },
  ) {
    return new FindQuery(this, options).filter({
      ...(searchTerm
        ? {
          $text: typeof searchTerm === "object"
            ? searchTerm
            : { $search: searchTerm },
        }
        : {}),
    });
  }

  public findOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: TCacheOptions },
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
    options?: AggregateOptions & { cache?: TCacheOptions },
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
    > ? FindOneQuery<M, S, Exclude<R, null>>
      : never;

    return Query as UnnulledFindOneQuery<typeof Query>;
  }

  public count(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: CountDocumentsOptions & { cache?: TCacheOptions },
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("count", Filter, options);
    return Mongo.useCaching(
      () => this.collection.countDocuments(Filter, options),
      options?.cache,
    );
  }

  public async exists(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: CountDocumentsOptions & { cache?: TCacheOptions },
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("exists", Filter, options);
    return !!(await Mongo.useCaching(
      () => this.collection.countDocuments(Filter, options),
      options?.cache,
    ));
  }

  public watch(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: ChangeStreamOptions,
  ) {
    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("watch", Filter, options);
    return this.collection.watch<OutputDocument<OutputShape>>(
      [{ $match: Filter }],
      options,
    );
  }

  public updateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
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

  public async updateOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
  ) {
    const Result = await this.updateOne(filter, updates, options);

    if (!Result.modifiedCount) {
      throw new Error("Record update has been failed!");
    }

    return Result;
  }

  public updateAndFindOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
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

  public findAndUpdateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
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

  public updateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
  ) {
    return new UpdateManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public async updateManyOrFail(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
  ) {
    const Result = await this.updateMany(filter, updates, options);

    if (!Result.modifiedCount) {
      throw new Error("Record update has been failed!");
    }

    return Result;
  }

  public updateAndFindMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
  ) {
    return new UpdateAndFindManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public findAndUpdateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: UpdateOptions & { validate?: boolean },
  ) {
    return new FindAndUpdateManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public deleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions,
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
    options?: DeleteOptions,
  ) {
    const Result = await this.deleteOne(filter, options);

    if (!Result.deletedCount) {
      throw new Error("Record deletion has been failed!");
    }

    return Result;
  }

  public findAndDeleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions,
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
    options?: DeleteOptions,
  ) {
    return new DeleteManyQuery(this, options).filter(filter as any);
  }

  public async deleteManyOrFail(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions,
  ) {
    const Result = await this.deleteMany(filter, options);

    if (!Result.deletedCount) {
      throw new Error("Record deletion has been failed!");
    }

    return Result;
  }

  public findAndDeleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions,
  ) {
    return new FindAndDeleteManyQuery(this, options).filter(filter as any);
  }

  public async replaceOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    doc: InputDocument<InputShape>,
    options?: ReplaceOptions,
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
        Promise.resolve(doc),
      )) ?? doc;

    this.log("replaceOne", Filter, doc, options);

    const Doc = await this.getSchema().validate(doc, {
      name: this.name,
    });

    const Result = (await this.collection.replaceOne(Filter, Doc, options)) as
      | InputDocument<InputShape>
      | UpdateResult<InputDocument<InputShape>>;

    for (const Hook of this.PostHooks.replace ?? []) {
      await Hook({
        event: "replace",
        method: "replaceOne",
        data: Result,
      });
    }

    return Result;
  }

  public populate<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>): MongoModel<
    Schema,
    InputShape,
    PopulatedDocument<OutputShape, F, S[]>
  > {
    const Model = new (this["constructor"] as typeof MongoModel)(
      this.name,
      this.schema,
      this.options,
    );

    Model["populateConfig"] = {
      field,
      model,
      options: options as any,
    };

    return Model as any;
  }

  public populateOne<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>): MongoModel<
    Schema,
    InputShape,
    PopulatedDocument<OutputShape, F, S>
  > {
    const Model = new (this["constructor"] as typeof MongoModel)(
      this.name,
      this.schema,
      this.options,
    );

    Model["populateConfig"] = {
      field,
      model,
      options: {
        ...(options as any),
        unwind: true,
      },
    };

    return Model as any;
  }
}

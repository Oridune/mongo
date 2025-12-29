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
  highlightEs,
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
  CountQuery,
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
import { MongoTransaction, type WithMongoTxn } from "./transaction.ts";

export interface ModelOptions {
  /**
   * A connection index determines which database to connect with.
   */
  connectionIndex?: number;

  /**
   * Target database name
   */
  database?: string;

  /**
   * Specify the collection options for native mongodb driver
   */
  collectionOptions?: CollectionOptions;

  /**
   * Enable or disable logs
   */
  logs?: boolean;
}

export class MongoModel<
  Schema extends ObjectValidator<any, any, any>,
  InputShape extends object = inferInput<Schema>,
  OutputShape extends object = inferOutput<Schema>,
> extends MongoHooks<InputShape, OutputShape> {
  protected databaseInstance?: Db;
  protected populateConfig?: Array<{
    field: string;
    model: MongoModel<any, any, any>;
    options?: PopulateOptions<any> & {
      unwind?: boolean;
    };
  }>;

  protected log(method: string, ...args: any[]) {
    if (this.options.logs || Mongo.enableLogs) {
      console.info(
        "Query Executed::",
        highlightEs(
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

  /**
   * Get the validator schema of this model.
   * @returns
   */
  public getSchema() {
    const Schema = typeof this.schema === "function"
      ? this.schema()
      : this.schema;

    if (!(Schema instanceof ObjectValidator)) {
      throw new Error(`Invalid or unexpected schema passed!`);
    }

    return e.deepCast(Schema);
  }

  /**
   * Get the validator schema of this model in update state.
   * @returns
   */
  public getUpdateSchema() {
    return this.getSchema();
  }

  public options: ModelOptions;

  /**
   * A connection index determines which database to connect with.
   */
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

  /**
   * Get access to the database on the native mongodb driver
   */
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

  /**
   * Get access to the collection on the native mongodb driver
   */
  get collection() {
    return this.database.collection(this.name, this.options.collectionOptions);
  }

  /**
   * Create a new index
   * @param indexDesc Describe your index
   * @returns
   */
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

  /**
   * Drop an index
   * @param indexNames Names of the indexes to be dropped
   * @param options
   * @returns
   */
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

  /**
   * Create a new document in the collection
   * @param doc
   * @param options
   * @returns
   */
  public async create(
    doc: InputDocument<InputShape>,
    options?: WithMongoTxn<InsertOneOptions & { validate?: boolean }>,
  ): Promise<OutputDocument<OutputShape>> {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    doc =
      (await this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(doc),
      )) ?? doc;

    this.log("create", doc, opts);

    const Doc = opts?.validate === false
      ? doc
      : await this.getSchema().validate(doc, {
        name: this.name,
        context: {
          databaseOperation: "create",
        },
      });

    const Ack = await this.collection.insertOne(Doc, opts);
    const Result = { _id: Ack.insertedId, ...Doc };

    return (
      this.PostHooks.create?.reduce<any>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(Result),
      ) ?? Result
    );
  }

  /**
   * Create multiple documents in a single query
   * @param docs
   * @param options
   * @returns
   */
  public async createMany(
    docs: InputDocument<InputShape>[],
    options?: WithMongoTxn<BulkWriteOptions & { validate?: boolean }>,
  ): Promise<OutputDocument<OutputShape>[]> {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

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

    this.log("createMany", docs, opts);

    const Docs = opts?.validate === false
      ? docs
      : await e.array(this.getSchema()).validate(docs, {
        name: this.name,
        context: {
          databaseOperation: "create",
        },
      });

    const Ack = await this.collection.insertMany(Docs, opts);

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

  /**
   * Search for documents on this collection using full text index
   *
   * A full text search index is required.
   * @param searchTerm
   * @param options
   * @returns
   */
  public search(
    searchTerm?:
      | string
      | {
        $search: string;
        $language?: string;
        $caseSensitive?: boolean;
        $diacriticSensitive?: boolean;
      },
    options?: WithMongoTxn<AggregateOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new FindQuery(this, opts).filter({
      ...(searchTerm
        ? {
          $text: typeof searchTerm === "object"
            ? searchTerm
            : { $search: searchTerm },
        }
        : {}),
    });
  }

  /**
   * Find documents from this collection
   * @param filter
   * @param options
   * @returns
   */
  public find(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<AggregateOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new FindQuery(this, opts).filter(filter as any);
  }

  /**
   * Find a single document
   * @param filter
   * @param options
   * @returns
   */
  public findOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<AggregateOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindOneQuery(this, opts).filter(Filter);
  }

  /**
   * Try to find a single document. If not found, throws an error.
   * @param filter
   * @param options
   * @returns
   */
  public findOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<AggregateOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Query = this.findOne(filter, {
      ...opts,
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

  /**
   * Count all documents given a specific filter/conditions.
   * @param filter
   * @param options
   * @returns
   */
  public count(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<AggregateOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new CountQuery(this, opts).filter(Filter);
  }

  /**
   * Check if document(s) exists.
   * @param filter
   * @param options
   * @returns
   */
  public async exists(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<CountDocumentsOptions & { cache?: TCacheOptions }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("exists", Filter, opts);

    return !!(await Mongo.useCaching(
      () => this.collection.countDocuments(Filter, opts),
      opts?.cache,
    ));
  }

  /**
   * Watch for real time updates from mongodb
   * @param filter
   * @param options
   * @returns
   */
  public watch(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<ChangeStreamOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    this.log("watch", Filter, opts);

    return this.collection.watch<OutputDocument<OutputShape>>(
      [{ $match: Filter }],
      opts,
    );
  }

  /**
   * Update a single document
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public updateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new UpdateOneQuery(this, opts)
      .filter(Filter)
      .updates(updates as any);
  }

  /**
   * Try to update a single document. Throws an error if failed to update or condition didn't met.
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public async updateOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Result = await this.updateOne(filter, updates, opts);

    if (!Result.modifiedCount) {
      throw new Error("Record update has been failed!");
    }

    return Result;
  }

  /**
   * Update a single document and then return the updated document
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public updateAndFindOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new UpdateAndFindOneQuery(this, opts)
      .filter(Filter)
      .updates(updates as any);
  }

  /**
   * Find a single document and update it. Returns the old verion of the document
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public findAndUpdateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindAndUpdateOneQuery(this, opts)
      .filter(Filter)
      .updates(updates as any);
  }

  /**
   * Update many documents
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public updateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new UpdateManyQuery(this, opts)
      .filter(filter as any)
      .updates(updates as any);
  }

  /**
   * Try to update many documents. Throws an error if failed or couldn't update a single document.
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public async updateManyOrFail(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Result = await this.updateMany(filter, updates, opts);

    if (!Result.modifiedCount) {
      throw new Error("Record update has been failed!");
    }

    return Result;
  }

  /**
   * Update many documents and then return them.
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public updateAndFindMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new UpdateAndFindManyQuery(this, opts)
      .filter(filter as any)
      .updates(updates as any);
  }

  /**
   * Find many documents and update them, returning the old version of documents.
   * @param filter
   * @param updates
   * @param options
   * @returns
   */
  public findAndUpdateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?:
      & UpdateFilter<InputDocument<InputShape>>
      & Partial<InputDocument<InputShape>>,
    options?: WithMongoTxn<UpdateOptions & { validate?: boolean }>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new FindAndUpdateManyQuery(this, opts)
      .filter(filter as any)
      .updates(updates as any);
  }

  /**
   * Delete a single document
   * @param filter
   * @param options
   * @returns
   */
  public deleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new DeleteOneQuery(this, opts).filter(Filter);
  }

  /**
   * Try to delete a single document. Throws an error if couldn't delete.
   * @param filter
   * @param options
   * @returns
   */
  public async deleteOneOrFail(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Result = await this.deleteOne(filter, opts);

    if (!Result.deletedCount) {
      throw new Error("Record deletion has been failed!");
    }

    return Result;
  }

  /**
   * Find and delete a single document, returning the document.
   * @param filter
   * @param options
   * @returns
   */
  public findAndDeleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Filter = (
      ObjectId.isValid(filter as any)
        ? { _id: new ObjectId(filter as any) }
        : filter
    ) as any;

    return new FindAndDeleteOneQuery(this, opts).filter(Filter);
  }

  /**
   * Delete many documents
   * @param filter
   * @param options
   * @returns
   */
  public deleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new DeleteManyQuery(this, opts).filter(filter as any);
  }

  /**
   * Try to delete many documents. Throws an error if couldn't delete.
   * @param filter
   * @param options
   * @returns
   */
  public async deleteManyOrFail(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    const Result = await this.deleteMany(filter, opts);

    if (!Result.deletedCount) {
      throw new Error("Record deletion has been failed!");
    }

    return Result;
  }

  /**
   * Find many and delete them
   * @param filter
   * @param options
   * @returns
   */
  public findAndDeleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: WithMongoTxn<DeleteOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

    return new FindAndDeleteManyQuery(this, opts).filter(filter as any);
  }

  /**
   * Replace a single document with another document
   * @param filter
   * @param doc
   * @param options
   * @returns
   */
  public async replaceOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    doc: InputDocument<InputShape>,
    options?: WithMongoTxn<ReplaceOptions>,
  ) {
    const opts = MongoTransaction.resolveCommandOpts(
      options,
      this.connectionIndex,
    );

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

    this.log("replaceOne", Filter, doc, opts);

    const Doc = await this.getSchema().validate(doc, {
      name: this.name,
      context: {
        databaseOperation: "replace",
      },
    });

    const Result = (await this.collection.replaceOne(Filter, Doc, opts)) as
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

  /**
   * Populates the array of references with documents referenced of another collection.
   * @param field
   * @param model
   * @param options
   * @returns
   */
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

    (Model["populateConfig"] ??= []).push(...(this.populateConfig ?? []), {
      field,
      model,
      options: options as any,
    });

    return Model as any;
  }

  /**
   * Populate a reference with a document
   * @param field
   * @param model
   * @param options
   * @returns
   */
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

    (Model["populateConfig"] ??= []).push(...(this.populateConfig ?? []), {
      field,
      model,
      options: {
        ...(options as any),
        unwind: true,
      },
    });

    return Model as any;
  }
}

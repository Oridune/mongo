// deno-lint-ignore-file no-explicit-any ban-types
import {
  e,
  ObjectValidator,
  inferInput,
  inferOutput,
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
} from "../deps.ts";
import { Mongo } from "./mongo.ts";
import { MongoHooks } from "./hooks.ts";
import {
  Flatten,
  InputDocument,
  OutputDocument,
  circularReplacer,
} from "./utility.ts";
import { FindQuery, FindOneQuery } from "./query/find.ts";
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
  protected log(method: string, ...args: any[]) {
    if (this.Options.logs || Mongo.enableLogs)
      console.info(
        highligthEs(
          `${this.database.databaseName}.${this.Name}.${method}(\n\r\t${args
            .map((arg) => {
              const Arg = { ...arg };

              if (Arg.session instanceof ClientSession)
                Arg.session = `new ClientSession(${(
                  Arg.session as ClientSession
                ).id?.id.toUUID()})`;

              return Arg ? JSON.stringify(Arg, circularReplacer()) : undefined;
            })
            .filter(Boolean)
            .join(",\n\r\t")}\n\r);`
        )
      );
  }

  constructor(
    public Name: string,
    public Schema: Schema,
    public Options: ModelOptions = {}
  ) {
    super();
  }

  get database() {
    if (!Mongo.client || !Mongo.isConnected())
      throw new Error(`Please connect to the database!`);

    return Mongo.client.db(this.Options.database);
  }

  get collection() {
    return this.database.collection(this.Name, this.Options.collectionOptions);
  }

  public async createIndex(
    ...indexDesc: (CreateIndexesOptions & {
      key: Partial<
        Record<keyof Flatten<InputShape> | (string & {}), IndexDirection>
      >;
      partialFilterExpression?: Filter<InputDocument<InputShape>>;
    })[]
  ) {
    this.log("createIndex", ...indexDesc);

    if (indexDesc.length)
      await this.collection
        .createIndexes(indexDesc as any)
        .catch(console.error);
  }

  public async create(
    doc: InputDocument<InputShape>,
    options?: InsertOneOptions
  ): Promise<OutputDocument<OutputShape>> {
    doc =
      (await this.PreHooks.create?.reduce<Promise<InputDocument<InputShape>>>(
        async (doc, hook) =>
          hook({ event: "create", method: "create", data: await doc }),
        Promise.resolve(doc)
      )) ?? doc;

    this.log("create", doc, options);

    const Doc = await this.Schema.validate(doc);
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
    options?: BulkWriteOptions
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

    const Docs = await e.array(this.Schema).validate(docs);
    const Ack = await this.collection.insertMany(Docs, options);

    return Promise.all(
      Docs.map((doc, index) => ({
        _id: Ack.insertedIds[index],
        ...doc,
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
    options?: AggregateOptions & { cache?: { key: string; ttl: number } }
  ) {
    return new FindQuery(this, options).filter(filter as any);
  }

  public findOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: AggregateOptions & { cache?: { key: string; ttl: number } }
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new FindOneQuery(this, options).filter(Filter);
  }

  public count(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: CountDocumentsOptions & { cache?: { key: string; ttl: number } }
  ) {
    this.log("count", filter, options);
    return Mongo.useCaching(
      () => this.collection.countDocuments(filter, options),
      options?.cache
    );
  }

  public watch(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: ChangeStreamOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    this.log("watch", Filter, options);
    return this.collection.watch<OutputDocument<OutputShape>>(
      [{ $match: Filter }],
      options
    );
  }

  public updateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new UpdateOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public updateAndFindOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new UpdateAndFindOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public findAndUpdateOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new FindAndUpdateOneQuery(this, options)
      .filter(Filter)
      .updates(updates as any);
  }

  public updateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
  ) {
    return new UpdateManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public updateAndFindMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
  ) {
    return new UpdateAndFindManyQuery(this, options)
      .filter(filter as any)
      .updates(updates as any);
  }

  public findAndUpdateMany(
    filter: Filter<InputDocument<InputShape>> = {},
    updates?: UpdateFilter<InputDocument<Flatten<InputShape> & InputShape>> &
      Partial<InputDocument<Flatten<InputShape> & InputShape>>,
    options?: UpdateOptions
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
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new DeleteOneQuery(this, options).filter(Filter);
  }

  public findAndDeleteOne(
    filter: ObjectId | string | Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    const Filter = (
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
    ) as any;

    return new FindAndDeleteOneQuery(this, options).filter(Filter);
  }

  public deleteMany(
    filter: Filter<InputDocument<InputShape>> = {},
    options?: DeleteOptions
  ) {
    return new DeleteManyQuery(this, options).filter(filter as any);
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
      ObjectId.isValid(filter as any) ? { _id: filter } : filter
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

    const Doc = await this.Schema.validate(doc);
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
}

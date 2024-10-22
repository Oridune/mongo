// deno-lint-ignore-file no-explicit-any
import type { DeleteOptions, UpdateOptions } from "../../deps.ts";
import type { MongoModel } from "../model.ts";
import { BaseUpdateQuery, UpdateManyQuery, UpdateOneQuery } from "./update.ts";
import {
  type BaseFindQuery,
  FindOneQuery,
  FindQuery,
  type PopulatedDocument,
  type PopulateOptions,
} from "./find.ts";
import { BaseDeleteQuery, DeleteManyQuery, DeleteOneQuery } from "./delete.ts";
import type { OutputDocument } from "../utility.ts";

export class BaseFindAndUpdateQuery<
  Model extends MongoModel<any, any, any>,
  Shape extends any,
  Result extends unknown,
> extends BaseUpdateQuery<Model, Shape, Result> {
  constructor(
    DatabaseModel: Model,
    protected FindQuery:
      | FindOneQuery<Model, Shape, Result>
      | FindQuery<Model, Shape, Result>,
  ) {
    super(DatabaseModel);
  }

  public sort(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["sort"]>
  ) {
    this.FindQuery?.sort(...args);

    return this;
  }

  public project(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["project"]>
  ) {
    this.FindQuery?.project(...args);

    return this;
  }

  public skip(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["skip"]>
  ) {
    this.FindQuery?.skip(...args);

    return this;
  }

  public limit(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["limit"]>
  ) {
    this.FindQuery?.limit(...args);

    return this;
  }

  public populate<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    this.FindQuery?.populate(field, model, options);

    return this as unknown as BaseFindAndUpdateQuery<
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
    this.FindQuery?.populateOne(field, model, options);

    return this as unknown as BaseFindAndUpdateQuery<
      Model,
      Shape,
      Result extends Array<infer R> ? PopulatedDocument<R, F, S>[]
        : PopulatedDocument<Result, F, S>
    >;
  }
}

export class BaseFindAndDeleteQuery<
  Model extends MongoModel<any, any, any>,
  Shape extends any,
  Result extends unknown,
> extends BaseDeleteQuery<Model, Shape, Result> {
  constructor(
    DatabaseModel: Model,
    protected FindQuery:
      | FindOneQuery<Model, Shape, Result>
      | FindQuery<Model, Shape, Result>,
  ) {
    super(DatabaseModel);
  }

  public sort(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["sort"]>
  ) {
    this.FindQuery?.sort(...args);

    return this;
  }

  public project(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["project"]>
  ) {
    this.FindQuery?.project(...args);

    return this;
  }

  public skip(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["skip"]>
  ) {
    this.FindQuery?.skip(...args);

    return this;
  }

  public limit(
    ...args: Parameters<BaseFindQuery<Model, Shape, Result>["limit"]>
  ) {
    this.FindQuery?.limit(...args);

    return this;
  }

  public populate<
    F extends string | `${string}.${string}`,
    M extends MongoModel<any, any, any>,
    S = OutputDocument<M extends MongoModel<any, any, infer R> ? R : never>,
  >(field: F, model: M, options?: PopulateOptions<M>) {
    this.FindQuery?.populate(field, model, options);

    return this as unknown as BaseFindAndUpdateQuery<
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
    this.FindQuery?.populateOne(field, model, options);

    return this as unknown as BaseFindAndUpdateQuery<
      Model,
      Shape,
      Result extends Array<infer R> ? PopulatedDocument<R, F, S>[]
        : PopulatedDocument<Result, F, S>
    >;
  }
}

export class UpdateAndFindOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null,
> extends BaseFindAndUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    await new UpdateOneQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return await this.FindQuery;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions,
  ) {
    super(
      DatabaseModel,
      new FindOneQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

export class FindAndUpdateOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null,
> extends BaseFindAndUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    const Result = await this.FindQuery;

    await new UpdateOneQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions,
  ) {
    super(
      DatabaseModel,
      new FindOneQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

export class UpdateAndFindManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseFindAndUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    await new UpdateManyQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return await this.FindQuery;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions,
  ) {
    super(
      DatabaseModel,
      new FindQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

export class FindAndUpdateManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseFindAndUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    const Result = await this.FindQuery;

    await new UpdateManyQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions,
  ) {
    super(
      DatabaseModel,
      new FindQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

export class FindAndDeleteOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null,
> extends BaseFindAndDeleteQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    const Result = await this.FindQuery;

    await new DeleteOneQuery(this.DatabaseModel, this.Options).filter(
      this.Filters,
    );

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions,
  ) {
    super(
      DatabaseModel,
      new FindOneQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

export class FindAndDeleteManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[],
> extends BaseFindAndDeleteQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    const Result = await this.FindQuery;

    await new DeleteManyQuery(this.DatabaseModel, this.Options).filter(
      this.Filters,
    );

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions,
  ) {
    super(
      DatabaseModel,
      new FindQuery<Model, Shape, Result>(DatabaseModel, {
        ...Options,
        initialFilter: () => this.Filters,
      }),
    );
  }
}

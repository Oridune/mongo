// deno-lint-ignore-file no-explicit-any
import { DeleteOptions, UpdateOptions } from "../../deps.ts";
import { MongoModel } from "../model.ts";
import { BaseUpdateQuery, UpdateManyQuery, UpdateOneQuery } from "./update.ts";
import { FindOneQuery, FindQuery } from "./find.ts";
import { BaseDeleteQuery, DeleteManyQuery, DeleteOneQuery } from "./delete.ts";
import { OutputDocument } from "../utility.ts";

export class UpdateAndFindOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    await new UpdateOneQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return (await new FindOneQuery(this.DatabaseModel, this.Options).filter(
      this.Filters
    )) as Result;
  }

  constructor(protected Model: Model, protected Options?: UpdateOptions) {
    super(Model);
  }
}

export class FindAndUpdateOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    const Result = (await new FindOneQuery(
      this.DatabaseModel,
      this.Options
    ).filter(this.Filters)) as Result;

    await new UpdateOneQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return Result;
  }

  constructor(protected Model: Model, protected Options?: UpdateOptions) {
    super(Model);
  }
}

export class UpdateAndFindManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[]
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    await new UpdateManyQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return (await new FindQuery(this.DatabaseModel, this.Options).filter(
      this.Filters
    )) as Result;
  }

  constructor(protected Model: Model, protected Options?: UpdateOptions) {
    super(Model);
  }
}

export class FindAndUpdateManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[]
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    const Result = (await new FindQuery(
      this.DatabaseModel,
      this.Options
    ).filter(this.Filters)) as Result;

    await new UpdateManyQuery(this.DatabaseModel, this.Options)
      .filter(this.Filters)
      .updates(this.Updates as any);

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: UpdateOptions
  ) {
    super(DatabaseModel);
  }
}

export class FindAndDeleteOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape> | null
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    const Result = (await new FindOneQuery(
      this.DatabaseModel,
      this.Options
    ).filter(this.Filters)) as Result;

    await new DeleteOneQuery(this.DatabaseModel, this.Options).filter(
      this.Filters
    );

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions
  ) {
    super(DatabaseModel);
  }
}

export class FindAndDeleteManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = OutputDocument<Shape>[]
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    const Result = (await new FindQuery(
      this.DatabaseModel,
      this.Options
    ).filter(this.Filters)) as Result;

    await new DeleteManyQuery(this.DatabaseModel, this.Options).filter(
      this.Filters
    );

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions
  ) {
    super(DatabaseModel);
  }
}

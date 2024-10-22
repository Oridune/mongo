// deno-lint-ignore-file no-explicit-any
import { BaseQuery } from "./base.ts";
import type { DeleteOptions, DeleteResult, Filter } from "../../deps.ts";
import type { MongoModel } from "../model.ts";
import type { InputDocument } from "../utility.ts";

export class BaseDeleteQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};

  constructor(protected Model: Model) {
    super();
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    this.Filters = filter;
    return this;
  }
}

export class DeleteOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteOne",
        filter: this.Filters,
      });

    this.DatabaseModel["log"]("deleteOne", this.Filters, this.Options);

    const Result = (await this.DatabaseModel.collection.deleteOne(
      this.Filters,
      this.Options
    )) as Result;

    for (const Hook of this.DatabaseModel["PostHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteOne",
        data: Result as any,
      });

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions
  ) {
    super(DatabaseModel);
  }
}

export class DeleteManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    for (const Hook of this.DatabaseModel["PreHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteMany",
        filter: this.Filters,
      });

    this.DatabaseModel["log"]("deleteMany", this.Filters, this.Options);

    const Result = (await this.DatabaseModel.collection.deleteMany(
      this.Filters,
      this.Options
    )) as Result;

    for (const Hook of this.DatabaseModel["PostHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteMany",
        data: Result as any,
      });

    return Result;
  }

  constructor(
    protected DatabaseModel: Model,
    protected Options?: DeleteOptions
  ) {
    super(DatabaseModel);
  }
}

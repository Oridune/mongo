// deno-lint-ignore-file no-explicit-any
import { BaseQuery } from "./base.ts";
import { DeleteOptions, DeleteResult, Filter } from "../../deps.ts";
import { MongoDocument, MongoModel } from "../model.ts";

export class BaseDeleteQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};

  constructor(protected Model: Model) {
    super();
  }

  public filter(filter: Filter<MongoDocument<Shape>>) {
    this.Filters = filter;
    return this;
  }
}

export class DeleteOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteOne",
        filter: this.Filters,
      });

    this.Model["log"]("deleteOne", this.Filters, this.Options);

    const Result = (await this.Model.collection.deleteOne(
      this.Filters,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteOne",
        data: Result as any,
      });

    return Result;
  }

  constructor(protected Model: Model, protected Options?: DeleteOptions) {
    super(Model);
  }
}

export class DeleteManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = DeleteResult
> extends BaseDeleteQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteMany",
        filter: this.Filters,
      });

    this.Model["log"]("deleteMany", this.Filters, this.Options);

    const Result = (await this.Model.collection.deleteMany(
      this.Filters,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].delete ?? [])
      await Hook({
        event: "delete",
        method: "deleteMany",
        data: Result as any,
      });

    return Result;
  }

  constructor(protected Model: Model, protected Options?: DeleteOptions) {
    super(Model);
  }
}

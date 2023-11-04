// deno-lint-ignore-file no-explicit-any
import e from "../../validator.ts";
import {
  Filter,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
} from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoModel } from "../model.ts";
import {
  InputDocument,
  deepObjectToFlatten,
  dotNotationToDeepObject,
} from "../utility.ts";

export class BaseUpdateQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>>
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};
  protected Updates: UpdateFilter<InputDocument<Shape>> = {};

  protected async validate<T extends UpdateFilter<InputDocument<Shape>>>(
    updates: T,
    options?: { validate?: boolean }
  ): Promise<T> {
    if (options?.validate !== false)
      if (updates.$set) {
        const SetSchema = e.deepPartial(this.Model.Schema);

        updates.$set = deepObjectToFlatten(
          await SetSchema.validate(dotNotationToDeepObject(updates.$set))
        ) as any;
      }

    return updates;
  }

  constructor(protected Model: Model) {
    super();
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    this.Filters = filter;
    return this;
  }

  public updates(
    updates: UpdateFilter<InputDocument<Shape>> & Partial<InputDocument<Shape>>
  ) {
    if (typeof updates === "object") {
      this.Updates = { ...this.Updates };

      for (const [Key, Value] of Object.entries(updates))
        if (/^\$.*/.test(Key))
          this.Updates[Key] = { ...this.Updates[Key], ...Value };
        else
          this.Updates = {
            ...this.Updates,
            $set: {
              ...this.Updates.$set!,
              [Key]: Value,
            },
          };
    }

    return this;
  }

  public set(set: UpdateFilter<InputDocument<Shape>>["$set"]) {
    this.Updates = {
      ...this.Updates,
      $set: { ...this.Updates?.$set!, ...set },
    };

    return this;
  }
}

export class UpdateOneQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>>
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });

    this.Model["log"]("updateOne", this.Filters, this.Updates, this.Options);

    const Updates = await this.validate(this.Updates, this.Options);

    const Result = (await this.Model.collection.updateOne(
      this.Filters,
      Updates,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        updates: Updates as any,
        data: Result as any,
      });

    return Result;
  }

  constructor(
    protected Model: Model,
    protected Options?: UpdateOptions & { validate?: boolean }
  ) {
    super(Model);
  }
}

export class UpdateManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>>
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected async exec(): Promise<Result> {
    for (const Hook of this.Model["PreHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });

    this.Model["log"]("updateMany", this.Filters, this.Updates, this.Options);

    const Updates = await this.validate(this.Updates, this.Options);

    const Result = (await this.Model.collection.updateMany(
      this.Filters,
      Updates as any,
      this.Options
    )) as Result;

    for (const Hook of this.Model["PostHooks"].update ?? [])
      await Hook({
        event: "update",
        method: "updateOne",
        updates: Updates as any,
        data: Result as any,
      });

    return Result;
  }

  constructor(
    protected Model: Model,
    protected Options?: UpdateOptions & { validate?: boolean }
  ) {
    super(Model);
  }
}

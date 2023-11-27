// deno-lint-ignore-file no-explicit-any
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
  assignDeepValues,
  dotNotationToDeepObject,
  pickProps,
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
    if (options?.validate !== false) {
      if (typeof updates.$set === "object")
        updates.$set = assignDeepValues(
          Object.keys(updates.$set),
          await this.Model.getUpdateSchema().validate(
            dotNotationToDeepObject(updates.$set)
          )
        );

      if (typeof updates.$setOnInsert === "object")
        updates.$setOnInsert = assignDeepValues(
          Object.keys(updates.$setOnInsert),
          await this.Model.getUpdateSchema().validate(
            dotNotationToDeepObject(updates.$setOnInsert)
          )
        );

      if (typeof updates.$push === "object") {
        const ModifierKeys: string[] = [];
        const InsertKeys: string[] = [];

        for (const [Key, Value] of Object.entries(updates.$push))
          if (
            typeof Value === "object" &&
            !!Value &&
            !!Object.keys(Value).find((_) =>
              /^\$(each|slice|position|sort)/.test(_)
            )
          )
            ModifierKeys.push(Key);
          else InsertKeys.push(Key);

        updates.$push = {
          ...assignDeepValues(
            InsertKeys,
            await this.Model.getUpdateSchema().validate(
              dotNotationToDeepObject(pickProps(InsertKeys, updates.$push))
            ),
            (value, key) =>
              !(updates.$push![key] instanceof Array) && value instanceof Array
                ? value[0]
                : value
          ),
          ...assignDeepValues(
            ModifierKeys,
            await this.Model.getUpdateSchema().validate(
              dotNotationToDeepObject(
                pickProps(ModifierKeys, updates.$push, (value) => value.$each)
              )
            ),
            (value, key) => ({ ...updates.$push![key], $each: value })
          ),
        };
      }
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

    const Updates = await this.validate(this.Updates, this.Options);

    this.Model["log"]("updateOne", this.Filters, Updates, this.Options);

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

    const Updates = await this.validate(this.Updates, this.Options);

    this.Model["log"]("updateMany", this.Filters, Updates, this.Options);

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

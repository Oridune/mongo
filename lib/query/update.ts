// deno-lint-ignore-file no-explicit-any
import {
  Filter,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  PushOperator,
  SetFields,
} from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import { MongoModel } from "../model.ts";
import {
  InputDocument,
  assignDeepValues,
  dotNotationToDeepObject,
  mongodbModifiersToObject,
  pickProps,
} from "../utility.ts";
import e from "../../validator.ts";

export class BaseUpdateQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>>
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};
  protected Updates: UpdateFilter<InputDocument<Shape>> = {};

  protected async validatePushOrSet(
    data: PushOperator<InputDocument<Shape>> | SetFields<InputDocument<Shape>>
  ) {
    const ModifierKeys: string[] = [];
    const InsertKeys: string[] = [];

    for (const [Key, Value] of Object.entries(data))
      if (
        typeof Value === "object" &&
        !!Value &&
        !!Object.keys(Value).find((_) =>
          /^\$(each|slice|position|sort)/.test(_)
        )
      )
        ModifierKeys.push(Key);
      else InsertKeys.push(Key);

    return {
      ...assignDeepValues(
        InsertKeys,
        await e
          .deepPartial(this.Model.getUpdateSchema())
          .validate(dotNotationToDeepObject(pickProps(InsertKeys, data))),
        {
          modifier: (value, key) =>
            !(data[key] instanceof Array) && value instanceof Array
              ? value[0]
              : value,
        }
      ),
      ...assignDeepValues(
        ModifierKeys,
        await e
          .partial(this.Model.getUpdateSchema())
          .validate(
            dotNotationToDeepObject(
              pickProps(ModifierKeys, data, (value) => value.$each)
            )
          ),
        { modifier: (value, key) => ({ ...data[key], $each: value }) }
      ),
    };
  }

  protected async validate<T extends UpdateFilter<InputDocument<Shape>>>(
    updates: T,
    options?: { validate?: boolean }
  ): Promise<T> {
    if (options?.validate !== false) {
      if (typeof updates.$set === "object")
        updates.$set = assignDeepValues(
          Object.keys(updates.$set),
          await e
            .deepPartial(this.Model.getUpdateSchema())
            .validate(dotNotationToDeepObject(updates.$set)),
          {
            resolver: (value, key, parent) => {
              if (key === "$") return parent[0];
              return value;
            },
          }
        );

      if (typeof updates.$setOnInsert === "object")
        updates.$setOnInsert = assignDeepValues(
          Object.keys(updates.$setOnInsert),
          await e
            .deepPartial(this.Model.getUpdateSchema())
            .validate(dotNotationToDeepObject(updates.$setOnInsert)),
          {
            resolver: (value, key, parent) => {
              if (key === "$") return parent[0];
              return value;
            },
          }
        );

      if (typeof updates.$push === "object")
        updates.$push = await this.validatePushOrSet(updates.$push);

      if (typeof updates.$addToSet === "object")
        updates.$addToSet = await this.validatePushOrSet(updates.$addToSet);
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
  Result = UpdateResult<InputDocument<Shape>> & {
    modifications: InputDocument<Shape>;
  }
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

    const Result = {
      ...(await this.Model.collection.updateOne(
        this.Filters,
        Updates,
        this.Options
      )),
      get modifications() {
        return dotNotationToDeepObject(
          mongodbModifiersToObject(Updates as any)
        );
      },
    } as Result;

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
  Result = UpdateResult<InputDocument<Shape>> & {
    modifications: InputDocument<Shape>;
  }
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

    const Result = {
      ...(await this.Model.collection.updateMany(
        this.Filters,
        Updates as any,
        this.Options
      )),
      get modifications() {
        return dotNotationToDeepObject(
          mongodbModifiersToObject(Updates as any)
        );
      },
    } as Result;

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

// deno-lint-ignore-file no-explicit-any
import type {
  Filter,
  MatchKeysAndValues,
  PushOperator,
  SetFields,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
} from "../../deps.ts";
import { BaseQuery } from "./base.ts";
import type { MongoModel } from "../model.ts";
import {
  assignDeepValues,
  dotNotationToDeepObject,
  type InputDocument,
  mongodbModifiersToObject,
  omitProps,
  pickProps,
} from "../utility.ts";
import e from "../../validator.ts";

export class BaseUpdateQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>>,
> extends BaseQuery<Result> {
  protected Filters: Record<string, any> = {};
  protected Updates: UpdateFilter<InputDocument<Shape>> = {};

  protected async validatePushOrAddToSet(
    data: PushOperator<InputDocument<Shape>> | SetFields<InputDocument<Shape>>,
  ) {
    const ModifierKeys: string[] = [];
    const InsertKeys: string[] = [];

    for (const [Key, Value] of Object.entries(data)) {
      if (
        typeof Value === "object" &&
        !!Value &&
        !!Object.keys(Value).find((_) =>
          /^\$(each|slice|position|sort)/.test(_)
        )
      ) ModifierKeys.push(Key);
      else InsertKeys.push(Key);
    }

    const PickedInsertKeys = pickProps(InsertKeys, data);
    const PickedModifierKeys = pickProps(ModifierKeys, data, (value) => value.$each);

    const FlattenInsertKeys = dotNotationToDeepObject(PickedInsertKeys);
    const FlattenModifierKeys = dotNotationToDeepObject(PickedModifierKeys);

    const RootInsertKeys = Object.keys(FlattenInsertKeys);
    const RootModifierKeys = Object.keys(FlattenModifierKeys);

    return {
      ...assignDeepValues(
        InsertKeys,
        await e.partial(e.pick(this.DatabaseModel.getUpdateSchema(), RootInsertKeys))
          .validate(FlattenInsertKeys, {
            name: this.DatabaseModel.name,
            context: {
              databaseOperation: "update",
            },
          }),
        {
          modifier: (value, key) =>
            !(data[key] instanceof Array) && value instanceof Array
              ? value[0]
              : value,
        },
      ),
      ...assignDeepValues(
        ModifierKeys,
        await e.deepPartial(e.pick(this.DatabaseModel.getUpdateSchema(), RootModifierKeys))
          .validate(
            FlattenModifierKeys,
            {
              name: this.DatabaseModel.name,
              deepOptions: {
                preserveShape: true,
              },
              context: {
                databaseOperation: "update",
              },
            },
          ),
        { modifier: (value, key) => ({ ...data[key], $each: value }) },
      ),
    };
  }

  protected async validateSet(data: MatchKeysAndValues<InputDocument<Shape>>) {
    const Keys = Object.keys(data);
    const ExpressionKeys: string[] = [];
    const ReplacementKeys: string[] = [];

    const ExpressionRegex = /^\$(.+)/; // Keys like $inc
    const ReplacerRegex = /\.\$(\[.*\])?$/; // Keys like something.$[foo], something.$

    for (const [Key, Value] of Object.entries(data)) {
      if (typeof Value === "object" && !!Value) {
        if (Object.keys(Value).find((_) => ExpressionRegex.test(_))) {
          ExpressionKeys.push(Key);
        }
      }

      if (ReplacerRegex.test(Key)) {
        ReplacementKeys.push(Key.replace(ReplacerRegex, ""));
      }
    }

    const Schema = this.DatabaseModel.getUpdateSchema();
    const ResolvedSchema = e.object().extends(
      e.deepPartial(e.omit(Schema, ReplacementKeys), { noDefaults: true }),
    ).extends(e.pick(Schema, ReplacementKeys));

    return {
      ...assignDeepValues(
        Keys,
        await ResolvedSchema
          .validate(dotNotationToDeepObject(omitProps(ExpressionKeys, data)), {
            name: this.DatabaseModel.name,
            deepOptions: {
              preserveShape: true,
            },
            context: {
              databaseOperation: "update",
            },
          }),
      ),
      ...pickProps(ExpressionKeys, data),
    };
  }

  protected async validate<T extends UpdateFilter<InputDocument<Shape>>>(
    updates: T,
    options?: { validate?: boolean },
  ): Promise<T> {
    if (options?.validate !== false) {
      if (typeof updates.$set === "object") {
        updates.$set = await this.validateSet(updates.$set);
      }

      if (typeof updates.$setOnInsert === "object") {
        updates.$setOnInsert = await this.validateSet(updates.$setOnInsert);
      }

      if (typeof updates.$push === "object") {
        updates.$push = await this.validatePushOrAddToSet(updates.$push);
      }

      if (typeof updates.$addToSet === "object") {
        updates.$addToSet = await this.validatePushOrAddToSet(
          updates.$addToSet,
        );
      }
    }

    return updates;
  }

  constructor(protected DatabaseModel: Model) {
    super();
  }

  public filter(filter: Filter<InputDocument<Shape>>) {
    this.Filters = filter;
    return this;
  }

  public updates(
    updates: UpdateFilter<InputDocument<Shape>> & Partial<InputDocument<Shape>>,
  ) {
    if (typeof updates === "object") {
      this.Updates = { ...this.Updates };

      for (const [Key, Value] of Object.entries(updates)) {
        if (/^\$.*/.test(Key)) {
          this.Updates[Key] = { ...this.Updates[Key], ...Value };
        } else {
          this.Updates = {
            ...this.Updates,
            $set: {
              ...this.Updates.$set!,
              [Key]: Value,
            },
          };
        }
      }
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
  },
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    for (const Hook of this.DatabaseModel["PreHooks"].update ?? []) {
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });
    }

    const Updates = await this.validate(this.Updates, this.Options);

    this.DatabaseModel["log"]("updateOne", this.Filters, Updates, this.Options);

    const Result = {
      ...(await this.DatabaseModel.collection.updateOne(
        this.Filters,
        Updates as UpdateFilter<any>,
        this.Options,
      )),
      get modifications() {
        return dotNotationToDeepObject(
          mongodbModifiersToObject(Updates as any),
        );
      },
    } as Result;

    for (const Hook of this.DatabaseModel["PostHooks"].update ?? []) {
      await Hook({
        event: "update",
        method: "updateOne",
        updates: Updates as any,
        data: Result as any,
      });
    }

    return Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions & { validate?: boolean },
  ) {
    super(DatabaseModel);
  }
}

export class UpdateManyQuery<
  Model extends MongoModel<any, any, any>,
  Shape = Model extends MongoModel<any, any, infer R> ? R : never,
  Result = UpdateResult<InputDocument<Shape>> & {
    modifications: InputDocument<Shape>;
  },
> extends BaseUpdateQuery<Model, Shape, Result> {
  protected override async exec(): Promise<Result> {
    for (const Hook of this.DatabaseModel["PreHooks"].update ?? []) {
      await Hook({
        event: "update",
        method: "updateOne",
        filter: this.Filters,
        updates: this.Updates as any,
      });
    }

    const Updates = await this.validate(this.Updates, this.Options);

    this.DatabaseModel["log"](
      "updateMany",
      this.Filters,
      Updates,
      this.Options,
    );

    const Result = {
      ...(await this.DatabaseModel.collection.updateMany(
        this.Filters,
        Updates as any,
        this.Options,
      )),
      get modifications() {
        return dotNotationToDeepObject(
          mongodbModifiersToObject(Updates as any),
        );
      },
    } as Result;

    for (const Hook of this.DatabaseModel["PostHooks"].update ?? []) {
      await Hook({
        event: "update",
        method: "updateOne",
        updates: Updates as any,
        data: Result as any,
      });
    }

    return Result;
  }

  constructor(
    protected override DatabaseModel: Model,
    protected Options?: UpdateOptions & { validate?: boolean },
  ) {
    super(DatabaseModel);
  }
}

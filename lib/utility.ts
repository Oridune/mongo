// deno-lint-ignore-file no-explicit-any
import { type UpdateFilter, type ObjectId, type Document } from "../deps.ts";
import { type IsObject as _IsObject } from "../validator.ts";

type IsObject<T, R, F = T> = _IsObject<T, R, F, ObjectId>;

// // "a.b.c" => "b.c"
// type Tail<S> = S extends `${string}.${infer T}` ? Tail<T> : S;

// // typeof Object.values(T)
// type Value<T> = T[keyof T];

// // {a: {b: 1, c: 2}} => {"a.b": {b: 1, c: 2}, "a.c": {b: 1, c: 2}}
// type FlattenStepOne<T> = {
//   [K in keyof T as K extends string
//     ? IsObject<T[K], `${K}.${keyof T[K] & string}`, K>
//     : K]: IsObject<T[K], { [key in keyof T[K]]: T[K][key] }>;
// };

// // {"a.b": {b: 1, c: 2}, "a.c": {b: 1, c: 2}} => {"a.b": {b: 1}, "a.c": {c: 2}}
// type FlattenStepTwo<T> = {
//   [a in keyof T]: IsObject<
//     T[a],
//     Value<{ [M in keyof T[a] as M extends Tail<a> ? M : never]: T[a][M] }>
//   >;
// };

// // {a: {b: 1, c: {d: 1}}} => {"a.b": 1, "a.c": {d: 1}}
// type FlattenOneLevel<T> = FlattenStepTwo<FlattenStepOne<T>>;

// // {a: {b: 1, c: {d: 1}}} => {"a.b": 1, "a.b.c.d": 1}
// export type FlattenObject<T> = T extends FlattenOneLevel<T>
//   ? T
//   : FlattenObject<FlattenOneLevel<T>>;

type OptionalizeIfObject<T, R = Exclude<T, undefined>> = IsObject<
  R,
  Optionalize<R>,
  R extends Array<infer O> ? Array<OptionalizeIfObject<O>> : R
>;

type OptionalizeEach<T> = {
  [K in keyof T]: OptionalizeIfObject<T[K]>;
};

export type Optionalize<
  T,
  UndefinedKeys extends keyof T = {
    [K in keyof T]: undefined extends T[K] ? K : never;
  }[keyof T],
  RequiredT = Omit<T, UndefinedKeys>,
  DeepRequired = OptionalizeEach<RequiredT>,
  OptionalT = Pick<T, UndefinedKeys>,
  DeepOptional = OptionalizeEach<OptionalT>
> = DeepRequired & Partial<DeepOptional>;

export type InputDocument<T> = { _id?: ObjectId } & Omit<Optionalize<T>, "_id">;

export type OutputDocument<T> = { _id: ObjectId } & Omit<T, "_id">;

export const circularReplacer = () => {
  const seen = new WeakSet();
  return (_: any, value: any) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
};

export const deepObjectToFlatten = (
  obj: Record<string, any>,
  prefix = ""
): Record<string, any> => {
  return Object.keys(obj).reduce((acc, key) => {
    const propName = prefix ? `${prefix}.${key}` : key;
    if (
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      obj[key].constructor === Object
    )
      return { ...acc, ...deepObjectToFlatten(obj[key], propName) };
    else return { ...acc, [propName]: obj[key] };
  }, {});
};

export const dotNotationToDeepObject = (obj: Record<string, any>) => {
  const result: Record<string, any> = {};

  Object.keys(obj).forEach((key) => {
    const keys = key.split(".");
    let currentObj = result;

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];

      if (i === keys.length - 1) {
        currentObj[k] = obj[key];
      } else {
        if (!currentObj[k]) {
          currentObj[k] = {};
        }
        currentObj = currentObj[k];
      }
    }
  });

  return result;
};

export const assignDeepValues = (
  keys: string[],
  deepObject: any,
  options?: {
    modifier?: (value: any, key: string, parent: any) => any;
    resolver?: (value: any, key: string, parent: any) => any;
  }
) => {
  const Result: any = {};

  keys.forEach((key) => {
    let value = deepObject;
    let parent: any = undefined;

    const NestedKeys = key.split(".");

    let exists = true;

    for (const NestedKey of NestedKeys) {
      const Target =
        typeof options?.resolver === "function"
          ? options.resolver(value[NestedKey], NestedKey, value)
          : value[NestedKey];

      if (Target !== undefined) {
        parent = value;
        value = Target;
      } else {
        exists = false;
        break;
      }
    }

    const Value = exists ? value : undefined;

    Result[key] =
      typeof options?.modifier === "function"
        ? options?.modifier(Value, key, parent)
        : Value;
  });

  return Result;
};

export const pickProps = (
  keys: string[],
  object: any,
  modifier?: (value: any, key: string) => any
) => {
  const Result: any = {};

  for (const Key in object)
    if (keys.includes(Key))
      Result[Key] =
        typeof modifier === "function"
          ? modifier(object[Key], Key)
          : object[Key];

  return Result;
};

export const performanceStats = async <T>(
  key: string,
  callback: () => T,
  options?: { enabled?: boolean; logs?: boolean }
) => {
  if (!options?.enabled)
    return {
      result: await callback(),
    };

  const TimeStart = new Date();

  const Result = await callback();

  const TimeEnd = new Date();

  const TimeMs = TimeEnd.getTime() - TimeStart.getTime();

  if (options.logs) console.log(`It took ${TimeMs}ms to execute '${key}'.`);

  return {
    key,
    startedAt: TimeStart,
    endedAt: TimeEnd,
    result: Result,
    timeMs: TimeMs,
  };
};

export const mongodbModifiersToObject = (
  updates: UpdateFilter<Document>,
  result: Record<string, any> = {}
) => {
  if (typeof updates.$set === "object") {
    result = updates.$set;

    for (const $ of Object.keys(result).filter((key) => /\.\$\.?/.test(key))) {
      result[$.replace("$", "0")] = result[$];
      delete result[$];
    }
  }

  for (const Mode of ["$push", "$addToSet"])
    if (typeof updates[Mode] === "object")
      for (const SetterKey of Object.keys(updates[Mode]))
        result[SetterKey] = (() => {
          const Target = updates[Mode][SetterKey];
          if ("$each" in Target) return Target.$each;
          return [Target];
        })();

  return result;
};

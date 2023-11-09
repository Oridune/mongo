// deno-lint-ignore-file no-explicit-any
import { type ObjectId } from "../deps.ts";
import { type IsObject } from "../validator.ts";

// "a.b.c" => "b.c"
type Tail<S> = S extends `${string}.${infer T}` ? Tail<T> : S;

// typeof Object.values(T)
type Value<T> = T[keyof T];

// {a: {b: 1, c: 2}} => {"a.b": {b: 1, c: 2}, "a.c": {b: 1, c: 2}}
type FlattenStepOne<T> = {
  [K in keyof T as K extends string
    ? IsObject<T[K], `${K}.${keyof T[K] & string}`, K>
    : K]: IsObject<T[K], { [key in keyof T[K]]: T[K][key] }>;
};

// {"a.b": {b: 1, c: 2}, "a.c": {b: 1, c: 2}} => {"a.b": {b: 1}, "a.c": {c: 2}}
type FlattenStepTwo<T> = {
  [a in keyof T]: IsObject<
    T[a],
    Value<{ [M in keyof T[a] as M extends Tail<a> ? M : never]: T[a][M] }>
  >;
};

// {a: {b: 1, c: {d: 1}}} => {"a.b": 1, "a.c": {d: 1}}
type FlattenOneLevel<T> = FlattenStepTwo<FlattenStepOne<T>>;

// {a: {b: 1, c: {d: 1}}} => {"a.b": 1, "a.b.c.d": 1}
export type FlattenObject<T> = T extends FlattenOneLevel<T>
  ? T
  : FlattenObject<FlattenOneLevel<T>>;

export type Optionalize<
  T,
  UndefinedKeys extends keyof T = {
    [K in keyof T]: undefined extends T[K] ? K : never;
  }[keyof T],
  RequiredT = Omit<T, UndefinedKeys>,
  DeepRequired = {
    [K in keyof RequiredT]: IsObject<
      RequiredT[K],
      Optionalize<RequiredT[K]>,
      RequiredT[K]
    >;
  },
  OptionalT = Pick<T, UndefinedKeys>,
  DeepOptional = {
    [K in keyof OptionalT]: IsObject<
      OptionalT[K],
      Optionalize<OptionalT[K]>,
      OptionalT[K]
    >;
  }
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

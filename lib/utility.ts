// deno-lint-ignore-file no-explicit-any

// Returns R if T is an object, otherwise returns F
type IsObject<T, R, F = T> = T extends
  | ((...args: any[]) => any)
  | (new (...args: any[]) => any)
  | { constructor: new (...args: any[]) => any }
  | Date
  | Array<any>
  | URL
  ? F
  : T extends object
  ? R
  : F;

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
export type Flatten<T> = T extends FlattenOneLevel<T>
  ? T
  : Flatten<FlattenOneLevel<T>>;

export type Optionalize<T> = Partial<T> &
  Pick<
    T,
    {
      [P in keyof T]: T[P] extends Exclude<T[P], undefined> ? P : never;
    }[keyof T]
  >;

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

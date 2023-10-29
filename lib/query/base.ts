// deno-lint-ignore-file

export class BaseQuery<Result> {
  protected exec(): Promise<Result> {
    throw new Error(`Query execution implementation is required!`);
  }

  public then: Promise<Result>["then"] = (resolve, reject) =>
    this.exec().then(resolve).catch(reject);

  public catch: Promise<Result>["catch"] = (reject) =>
    this.exec().catch(reject);

  public finally: Promise<Result>["finally"] = (result) =>
    this.exec().finally(result);
}

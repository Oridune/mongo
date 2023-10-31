// deno-lint-ignore-file no-explicit-any
import {
  ObjectValidator,
  plural,
  MongoClient,
  MongoClientOptions,
  ClientSession,
} from "../deps.ts";
import { MongoModel, ModelOptions } from "./model.ts";

export type TCacheValue = object | number | boolean | string | null | undefined;

export type TCacheSetter = (
  key: string,
  value: TCacheValue,
  ttl: number
) => void | Promise<void>;
export type TCacheGetter = (key: string) => TCacheValue | Promise<TCacheValue>;
export type TCacheDelete = (key: string) => void | Promise<void>;

export class Mongo {
  static enableLogs = false;

  static client?: MongoClient;

  protected static preConnectEvents: Array<() => void | Promise<void>> = [];
  protected static postConnectEvents: Array<() => void | Promise<void>> = [];

  protected static preDisconnectEvents: Array<() => void | Promise<void>> = [];
  protected static postDisconnectEvents: Array<() => void | Promise<void>> = [];

  protected static cachingMethods?: {
    set: TCacheSetter;
    get: TCacheGetter;
    del: TCacheDelete;
  };

  protected static setCache(key: string, value: TCacheValue, ttl: number) {
    if (typeof this.cachingMethods?.set !== "function")
      throw new Error(`Caching methods are not provided!`);

    return this.cachingMethods.set(key, value, ttl);
  }

  protected static getCache(key: string) {
    if (typeof this.cachingMethods?.get !== "function")
      throw new Error(`Caching methods are not provided!`);

    return this.cachingMethods.get(key);
  }

  protected static deleteCache(key: string) {
    if (typeof this.cachingMethods?.del !== "function")
      throw new Error(`Caching methods are not provided!`);

    return this.cachingMethods.del(key);
  }

  static pre(
    event: "connect" | "disconnect",
    callback: () => void | Promise<void>
  ) {
    switch (event) {
      case "connect":
        this.preConnectEvents.push(callback);
        break;

      case "disconnect":
        this.preDisconnectEvents.push(callback);
        break;

      default:
        throw new Error(`Invalid event type '${event}'`);
    }
    return this;
  }

  static post(
    event: "connect" | "disconnect",
    callback: () => void | Promise<void>
  ) {
    switch (event) {
      case "connect":
        this.postConnectEvents.push(callback);
        break;

      case "disconnect":
        this.postDisconnectEvents.push(callback);
        break;

      default:
        throw new Error(`Invalid event type '${event}'`);
    }
    return this;
  }

  /**
   * Is database connected?
   * @returns
   */
  static isConnected() {
    return (
      this.client instanceof MongoClient &&
      "topology" in this.client &&
      typeof this.client.topology === "object" &&
      !!this.client.topology &&
      "isConnected" in this.client.topology &&
      typeof this.client.topology.isConnected === "function" &&
      !!this.client.topology.isConnected()
    );
  }

  static async connect(url: string, options?: MongoClientOptions) {
    // Execute Pre-Connect Events
    await Promise.all(this.preConnectEvents.map((_) => _()));

    this.client ??= await MongoClient.connect(url, options);

    // Execute Post-Connect Events
    await Promise.all(this.postConnectEvents.map((_) => _()));
  }

  static async disconnect() {
    // Execute Pre-Disconnect Events
    await Promise.all(this.preDisconnectEvents.map((_) => _()));

    this.client?.close();
    delete this.client;

    // Execute Post-Disconnect Events
    await Promise.all(this.postDisconnectEvents.map((_) => _()));
  }

  static async drop(dbName?: string | undefined) {
    await this.client?.db(dbName).dropDatabase();
  }

  static model<T extends ObjectValidator<any, any, any>>(
    name: string,
    schema: T,
    options?: ModelOptions
  ) {
    if (!(schema instanceof ObjectValidator))
      throw new Error(`Invalid or unexpected schema passed!`);

    return new MongoModel(plural(name), schema, options);
  }

  /**
   * Helper method to execute database transactions
   * @param callback Execute your queries in this callback
   * @param session Optionally pass an external (parent) session
   * @returns
   */
  static transaction<T>(
    callback: (session: ClientSession) => Promise<T>,
    session?: ClientSession
  ) {
    if (session) return callback(session);

    if (!this.client) throw new Error(`Please connect the client first!`);

    return this.client.withSession<T>(callback);
  }

  static setCachingMethods(
    setter: TCacheSetter,
    getter: TCacheGetter,
    deleter: TCacheDelete
  ) {
    if (
      typeof setter === "function" &&
      typeof getter === "function" &&
      typeof deleter === "function"
    )
      this.cachingMethods = {
        set: setter,
        get: getter,
        del: deleter,
      };
  }

  static async useCaching<T extends TCacheValue>(
    callback: () => Promise<T>,
    cache?: { key: string; ttl: number }
  ) {
    const Cached = cache?.key ? await this.getCache(cache.key) : undefined;
    const Result = (Cached ?? (await callback())) as T;

    if (cache?.key && Cached === undefined && Result !== undefined)
      await this.setCache(cache.key, Result, cache.ttl ?? 0);

    return Result;
  }
}

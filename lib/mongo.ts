// deno-lint-ignore-file no-explicit-any
import { ObjectValidator } from "../validator.ts";
import {
  plural,
  MongoClient,
  MongoClientOptions,
  ClientSession,
  ClientSessionOptions,
  TransactionOptions,
  EndSessionOptions,
} from "../deps.ts";
import { MongoModel, ModelOptions } from "./model.ts";
import { performanceStats } from "./utility.ts";

export type TCacheValue = object | number | boolean | string | null | undefined;

export enum CacheProvider {
  MAP = "map",
  REDIS = "redis",
}

export type TCacheSetter = (
  key: string,
  value: TCacheValue,
  ttl?: number
) => void | Promise<void>;
export type TCacheGetter = (key: string) => TCacheValue | Promise<TCacheValue>;
export type TCacheDelete = (key: string) => void | Promise<void>;

export type TCacheOptions = {
  key: string;

  /**
   * Time to live in seconds. The data might be cached for ever if not passed!
   */
  ttl?: number;

  /**
   * You can optionally pass dependencies to watch. The cache will be invalidated if the dependency changed.
   */
  deps?: Array<any>;

  /**
   * Enable logs to see the performance improvements.
   */
  logs?: boolean;
};

export class Mongo {
  static enableLogs = false;

  static client?: MongoClient;

  protected static preConnectEvents: Array<() => void | Promise<void>> = [];
  protected static postConnectEvents: Array<() => void | Promise<void>> = [];

  protected static preDisconnectEvents: Array<() => void | Promise<void>> = [];
  protected static postDisconnectEvents: Array<() => void | Promise<void>> = [];

  protected static cachingMethods?: {
    // deno-lint-ignore ban-types
    provider: CacheProvider | (string & {});
    set: TCacheSetter;
    get: TCacheGetter;
    del: TCacheDelete;
  };

  protected static setCache(key: string, value: TCacheValue, ttl?: number) {
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
    for (const _ of this.preConnectEvents) await _();

    this.client ??= await MongoClient.connect(url, options);

    // Execute Post-Connect Events
    for (const _ of this.postConnectEvents) await _();
  }

  static async disconnect() {
    // Execute Pre-Disconnect Events
    for (const _ of this.preDisconnectEvents) await _();

    this.client?.close();
    delete this.client;

    // Execute Post-Disconnect Events
    for (const _ of this.postDisconnectEvents) await _();
  }

  static async drop(dbName?: string | undefined) {
    await this.client?.db(dbName).dropDatabase();
  }

  static model<T extends ObjectValidator<any, any, any>>(
    name: string,
    schema: T | (() => T),
    options?: ModelOptions
  ) {
    return new MongoModel(plural(name), schema, options);
  }

  /**
   * Helper method to execute database transactions
   * @param callback Execute your queries in this callback
   * @param session Optionally pass an external (parent) session
   * @returns
   */
  static async transaction<T>(
    callback: (session: ClientSession) => Promise<T>,
    opts?:
      | {
          sessionOpts?: ClientSessionOptions;
          transactionOpts?: TransactionOptions;
          sessionEndOpts?: EndSessionOptions;
        }
      | ClientSession
  ) {
    if (opts instanceof ClientSession) return callback(opts);

    if (!this.client) throw new Error(`Please connect the client first!`);

    const Session = this.client.startSession(opts?.sessionOpts);

    try {
      Session.startTransaction(opts?.transactionOpts);

      const Result = await callback(Session);

      await Session.commitTransaction();

      return Result;
    } catch (error) {
      await Session.abortTransaction();

      throw error;
    } finally {
      await Session.endSession(opts?.sessionEndOpts);
    }
  }

  static setCachingMethods(options: {
    // deno-lint-ignore ban-types
    provider: CacheProvider | (string & {});
    setter: TCacheSetter;
    getter: TCacheGetter;
    deleter: TCacheDelete;
  }) {
    if (
      typeof options.setter === "function" &&
      typeof options.getter === "function" &&
      typeof options.deleter === "function"
    )
      this.cachingMethods = {
        provider: options.provider,
        set: options.setter,
        get: options.getter,
        del: options.deleter,
      };
  }

  static async useCaching<T extends TCacheValue>(
    callback: () => Promise<T>,
    cache?: TCacheOptions
  ) {
    if (typeof cache === "object" && cache !== null) {
      const CacheKey = cache.key;

      const Cached = (
        await performanceStats(
          `cache-fetch:${CacheKey}`,
          () => this.getCache(CacheKey),
          {
            enabled: cache.logs,
            logs: cache.logs,
          }
        )
      ).result;

      const Result = (Cached ?? (await callback())) as T;

      const EmptyResults = [null, undefined];

      if (
        EmptyResults.includes(Cached as any) &&
        Result !== undefined &&
        Result !== Cached
      )
        await this.setCache(CacheKey, Result, cache.ttl);

      return Result;
    }

    return callback();
  }
}

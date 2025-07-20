// deno-lint-ignore-file no-explicit-any ban-ts-comment
import pluralize from "npm:pluralize@8.0.0";
import type { ObjectValidator } from "../validator.ts";
import {
  ClientSession,
  type ClientSessionOptions,
  type EndSessionOptions,
  MongoClient,
  type MongoClientOptions,
  type TransactionOptions,
} from "../deps.ts";
import { type ModelOptions, MongoModel } from "./model.ts";
import { performanceStats } from "./utility.ts";

export type TCacheValue = object | number | boolean | string | null | undefined;

export enum CacheProvider {
  MAP = "map",
  REDIS = "redis",
}

export type TCacheSetter = (
  key: string,
  value: TCacheValue,
  ttl?: number,
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

  static clients: MongoClient[] = [];
  static models: Map<string, MongoModel<ObjectValidator<any>>> = new Map();

  protected static preConnectEvents: Array<
    (connectionIndex: number) => void | Promise<void>
  > = [];
  protected static postConnectEvents: Array<
    (connectionIndex: number) => void | Promise<void>
  > = [];

  protected static preDisconnectEvents: Array<
    (connectionIndex: number) => void | Promise<void>
  > = [];
  protected static postDisconnectEvents: Array<
    (connectionIndex: number) => void | Promise<void>
  > = [];

  protected static cachingMethods?: {
    // deno-lint-ignore ban-types
    provider?: CacheProvider | (string & {});
    set: TCacheSetter;
    get: TCacheGetter;
    del: TCacheDelete;
  };

  protected static setCache(key: string, value: TCacheValue, ttl?: number) {
    return this.cachingMethods?.set(key, value, ttl);
  }

  protected static getCache(key: string) {
    return this.cachingMethods?.get(key);
  }

  protected static deleteCache(key: string) {
    return this.cachingMethods?.del(key);
  }

  static pre(
    event: "connect" | "disconnect",
    callback: (connectionIndex: number) => void | Promise<void>,
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
    callback: (connectionIndex: number) => void | Promise<void>,
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
  static isConnected(connectionIndex?: number) {
    const isConnected = (i: number) => {
      const Conn = this.clients[i];

      return (
        Conn instanceof MongoClient &&
        "topology" in Conn &&
        typeof Conn.topology === "object" &&
        !!Conn.topology &&
        "isConnected" in Conn.topology &&
        typeof Conn.topology.isConnected === "function" &&
        !!Conn.topology.isConnected()
      );
    };

    if (typeof connectionIndex === "number") {
      return isConnected(connectionIndex);
    } else {
      return (
        !!this.clients.length &&
        this.clients.reduce(
          (connected, _, i) => connected && isConnected(i),
          true,
        )
      );
    }
  }

  static async connect(
    urls: string | string[],
    options?: MongoClientOptions | MongoClientOptions[],
  ) {
    const Urls = urls instanceof Array ? urls : urls.trim().split(/\s*,\s*/);
    const Options = options instanceof Array ? options : [options];

    await Promise.all(
      Urls.map(async (url, i) => {
        const options = Options[i];

        // Execute Pre-Connect Events
        for (const _ of this.preConnectEvents) await _(i);

        this.clients[i] ??= await MongoClient.connect(url, options);

        // Execute Post-Connect Events
        for (const _ of this.postConnectEvents) await _(i);
      }),
    );
  }

  static async disconnect(connectionIndex?: number) {
    const close = async (i: number) => {
      // Execute Pre-Disconnect Events
      for (const _ of this.preDisconnectEvents) await _(i);

      this.clients[i]?.close();
      delete this.clients[i];

      // Execute Post-Disconnect Events
      for (const _ of this.postDisconnectEvents) await _(i);
    };

    if (typeof connectionIndex === "number") await close(connectionIndex);
    else await Promise.all(this.clients.map((_, i) => close(i)));
  }

  static async drop(connectionIndex?: number, dbName?: string | undefined) {
    await this.clients[connectionIndex ?? 0]?.db(dbName).dropDatabase();
  }

  static async dropAll(dbName?: string | undefined) {
    for (const client of this.clients) {
      await client.db(dbName).dropDatabase();
    }
  }

  static model<T extends ObjectValidator<any>>(
    name: string,
    schema: T | (() => T),
    opts?: ModelOptions | number,
  ) {
    const Model = new MongoModel(pluralize(name), schema, opts);

    this.models.set(name, Model as any);

    return Model;
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
        connectionIndex?: number;
        sessionOpts?: ClientSessionOptions;
        transactionOpts?: TransactionOptions;
        sessionEndOpts?: EndSessionOptions;
      }
      | ClientSession
      | number,
    connectionIndex?: number,
  ) {
    if (opts instanceof ClientSession) {
      if (
        "_connectionIndex" in opts &&
        typeof opts._connectionIndex === "number" &&
        typeof connectionIndex === "number" &&
        opts._connectionIndex !== connectionIndex
      ) {
        throw new Error(
          `ClientSession for a different connection index '${opts._connectionIndex}' cannot execute the transaction of connection index '${connectionIndex}'!`,
        );
      }

      return callback(opts);
    }

    const Opts = typeof opts === "number" ? { connectionIndex: opts } : opts;
    const CIndex = Opts?.connectionIndex ?? connectionIndex ?? 0;
    const Conn = this.clients[CIndex];

    if (!Conn) throw new Error(`Please connect the client first!`);

    return await Conn.withSession(Opts?.sessionOpts ?? {}, async (session) => {
      // @ts-ignore
      session._connectionIndex = CIndex;

      return await session.withTransaction(callback, Opts?.transactionOpts);
    });
  }

  static setCachingMethods(options: {
    // deno-lint-ignore ban-types
    provider?: CacheProvider | (string & {});
    setter: TCacheSetter;
    getter: TCacheGetter;
    deleter: TCacheDelete;
  }) {
    if (
      typeof options.setter === "function" &&
      typeof options.getter === "function" &&
      typeof options.deleter === "function"
    ) {
      this.cachingMethods = {
        provider: options.provider,
        set: options.setter,
        get: options.getter,
        del: options.deleter,
      };
    }
  }

  static async useCaching<T extends TCacheValue>(
    callback: () => Promise<T>,
    cache?: TCacheOptions,
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
          },
        )
      ).result;

      const Result = (Cached ?? (await callback())) as T;

      const EmptyResults = [null, undefined];

      if (
        EmptyResults.includes(Cached as any) &&
        Result !== undefined &&
        Result !== Cached
      ) {
        await this.setCache(CacheKey, Result, cache.ttl);
      }

      return Result;
    }

    return callback();
  }
}

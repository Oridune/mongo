import {
  ClientSession,
  type ClientSessionOptions,
  type EndSessionOptions,
  type TransactionOptions,
} from "../deps.ts";
import { Mongo } from "./mongo.ts";

export type WithMongoTxn<T> = T extends object ? Omit<T, "session"> & {
    session?: ClientSession | MongoTransaction;
  }
  : T;

export type WithoutMongoTxn<T> = T extends object ? Omit<T, "session"> & {
    session?: ClientSession;
  }
  : T;

export class MongoTransaction {
  static transaction = <T>(
    callback: (session: MongoTransaction) => Promise<T> | void,
    opts?:
      | {
        sessionOpts?: ClientSessionOptions;
        transactionOpts?: TransactionOptions;
        sessionEndOpts?: EndSessionOptions;
      }
      | MongoTransaction
      | ClientSession,
  ) => new MongoTransaction().exec<T>(callback, opts);

  // deno-lint-ignore no-explicit-any
  static resolveCommandOpts = <T extends WithMongoTxn<any>>(
    opts: T,
    connectionIndex: number,
  ) => {
    if (
      opts &&
      typeof opts === "object" && "session" in opts &&
      opts.session instanceof MongoTransaction
    ) opts.session = opts.session.getSession(connectionIndex);

    return opts as WithoutMongoTxn<T>;
  };

  protected sessions = new Map<number, ClientSession>();

  public async exec<T>(
    callback: (session: MongoTransaction) => Promise<T> | void,
    opts?:
      | {
        sessionOpts?: ClientSessionOptions;
        transactionOpts?: TransactionOptions;
        sessionEndOpts?: EndSessionOptions;
      }
      | MongoTransaction
      | ClientSession,
  ) {
    if (opts instanceof MongoTransaction) return callback(opts);
    if (opts instanceof ClientSession) {
      if (
        !("_connectionIndex" in opts) ||
        typeof opts._connectionIndex !== "number"
      ) throw new Error("Invalid parent mongo session");

      const txn = new MongoTransaction();

      txn.sessions.set(opts._connectionIndex, opts);

      return callback(txn);
    }

    try {
      const results = await callback(this);

      await Promise.all(
        Array.from(this.sessions).map(([, session]) =>
          session.commitTransaction()
        ),
      );

      return results;
    } catch (error) {
      await Promise.all(
        Array.from(this.sessions).map(([, session]) =>
          session.abortTransaction()
        ),
      );

      throw error;
    }
  }

  public getSession(connectionIndex: number, opts?: ClientSessionOptions) {
    const Conn = Mongo.clients[connectionIndex];

    const session = Conn.startSession(opts);

    session.startTransaction();

    this.sessions.set(connectionIndex, session);

    return session;
  }
}

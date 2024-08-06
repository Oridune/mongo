// deno-lint-ignore-file ban-ts-comment
// @ts-ignore
import EsHighlighter from "npm:highlight-es@1.0.3";

export const highligthEs = (content: string): string => EsHighlighter(content);

export {
  MongoClient,
  ClientSession,
  ObjectId,
  type ClientSessionOptions,
  type EndSessionOptions,
  type MongoClientOptions,
  type TransactionOptions,
  type AggregateOptions,
  type BulkWriteOptions,
  type ChangeStreamOptions,
  type CollectionOptions,
  type CommandOperationOptions,
  type CountDocumentsOptions,
  type CreateIndexesOptions,
  type Db,
  type DeleteOptions,
  type Filter,
  type IndexDirection,
  type InsertOneOptions,
  type ReplaceOptions,
  type UpdateFilter,
  type UpdateOptions,
  type UpdateResult,
  type DeleteResult,
  type Document,
  type MatchKeysAndValues,
  type PushOperator,
  type SetFields,
} from "npm:mongodb@6.8.0";

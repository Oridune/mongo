import EsHighlighter from "highlighter";

export const highlightEs = (content: string): string => EsHighlighter(content);

export {
  type AggregateOptions,
  type BulkWriteOptions,
  type ChangeStreamOptions,
  ClientSession,
  type ClientSessionOptions,
  type CollectionOptions,
  type CommandOperationOptions,
  type CountDocumentsOptions,
  type CreateIndexesOptions,
  type Db,
  type DeleteOptions,
  type DeleteResult,
  type Document,
  type EndSessionOptions,
  type Filter,
  type IndexDirection,
  type InsertOneOptions,
  type MatchKeysAndValues,
  MongoClient,
  type MongoClientOptions,
  ObjectId,
  type PushOperator,
  type ReplaceOptions,
  type SetFields,
  type TransactionOptions,
  type UpdateFilter,
  type UpdateOptions,
  type UpdateResult,
} from "mongodb";

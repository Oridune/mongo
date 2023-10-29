// deno-lint-ignore-file no-explicit-any
import { DeleteResult, Document, Filter, UpdateResult } from "../deps.ts";
import { MongoDocument } from "./model.ts";
import { Flatten, Optionalize } from "./utility.ts";
import { UpdateFilter } from "./query/update.ts";

export type THooksDetails<InputShape, OutputShape> = {
  create: {
    pre: {
      details: {
        event: "create";
        method: "create" | "createMany";
        data: Optionalize<InputShape>;
      };
      returns: Optionalize<InputShape> | Promise<Optionalize<InputShape>>;
    };
    post: {
      details: {
        event: "create";
        method: "create" | "createMany";
        data: MongoDocument<OutputShape>;
      };
      returns: MongoDocument<OutputShape> | Promise<MongoDocument<OutputShape>>;
    };
  };
  read: {
    pre: {
      details: {
        event: "read";
        method: "find" | "findOne";
        aggregationPipeline: Document[];
      };
      returns: void | Promise<void>;
    };
    post: {
      details: {
        event: "read";
        method: "find" | "findOne";
        data: MongoDocument<OutputShape>;
      };
      returns: MongoDocument<OutputShape> | Promise<MongoDocument<OutputShape>>;
    };
  };
  update: {
    pre: {
      details: {
        event: "update";
        method: "updateOne" | "updateMany";
        filter: Filter<MongoDocument<OutputShape>>;
        updates: UpdateFilter<
          MongoDocument<Flatten<OutputShape> & OutputShape>
        >;
      };
      returns: void | Promise<void>;
    };
    post: {
      details: {
        event: "update";
        method: "updateOne" | "updateMany";
        data: UpdateResult<MongoDocument<OutputShape>>;
      };
      returns: void | Promise<void>;
    };
  };
  delete: {
    pre: {
      details: {
        event: "delete";
        method: "deleteOne" | "deleteMany";
        filter: Filter<MongoDocument<OutputShape>>;
      };
      returns: void | Promise<void>;
    };
    post: {
      details: {
        event: "delete";
        method: "deleteOne" | "deleteMany";
        data: DeleteResult;
      };
      returns: void | Promise<void>;
    };
  };
  replace: {
    pre: {
      details: {
        event: "replace";
        method: "replaceOne";
        filter: Filter<MongoDocument<OutputShape>>;
        replacement: Optionalize<InputShape>;
      };
      returns: Optionalize<InputShape> | Promise<Optionalize<InputShape>>;
    };
    post: {
      details: {
        event: "replace";
        method: "replaceOne";
        data:
          | MongoDocument<OutputShape>
          | UpdateResult<MongoDocument<OutputShape>>
          | Promise<
              | MongoDocument<OutputShape>
              | UpdateResult<MongoDocument<OutputShape>>
            >;
      };
      returns: void | Promise<void>;
    };
  };
};

export type THookType = "pre" | "post";
export type THookEvent = "create" | "read" | "update" | "delete" | "replace";

export type THookCallback<T extends THookType, E extends THookEvent, I, O> = (
  details: THooksDetails<I, O>[E][T]["details"]
) => THooksDetails<I, O>[E][T]["returns"];

export class MongoHooks<InputShape, OutputShape> {
  protected PreHooks: Partial<{
    [Key in THookEvent]: THookCallback<"pre", Key, InputShape, OutputShape>[];
  }> = {};
  protected PostHooks: Partial<{
    [Key in THookEvent]: THookCallback<"post", Key, InputShape, OutputShape>[];
  }> = {};

  public pre<E extends THookEvent>(
    event: E,
    callback: THookCallback<"pre", E, InputShape, OutputShape>
  ) {
    (this.PreHooks[event as THookEvent] ??= []).push(callback as any);
    return this;
  }

  public post<E extends THookEvent>(
    event: E,
    callback: THookCallback<"post", E, InputShape, OutputShape>
  ) {
    (this.PostHooks[event as THookEvent] ??= []).push(callback as any);
    return this;
  }
}

// deno-lint-ignore-file no-explicit-any
import {
  DeleteResult,
  Document,
  Filter,
  UpdateResult,
  UpdateFilter,
} from "../deps.ts";
import { InputDocument, OutputDocument } from "./utility.ts";

export type THooksDetails<InputShape, OutputShape> = {
  create: {
    pre: {
      details: {
        event: "create";
        method: "create" | "createMany";
        data: InputDocument<InputShape>;
      };
      returns: InputDocument<InputShape> | Promise<InputDocument<InputShape>>;
    };
    post: {
      details: {
        event: "create";
        method: "create" | "createMany";
        data: OutputDocument<OutputShape>;
      };
      returns:
        | OutputDocument<OutputShape>
        | Promise<OutputDocument<OutputShape>>;
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
        data: OutputDocument<OutputShape>;
      };
      returns:
        | OutputDocument<OutputShape>
        | Promise<OutputDocument<OutputShape>>;
    };
  };
  update: {
    pre: {
      details: {
        event: "update";
        method: "updateOne" | "updateMany";
        filter: Filter<InputDocument<InputShape>>;
        updates: UpdateFilter<InputDocument<InputShape>>;
      };
      returns: void | Promise<void>;
    };
    post: {
      details: {
        event: "update";
        method: "updateOne" | "updateMany";
        updates: UpdateFilter<InputDocument<InputShape>>;
        data: UpdateResult<InputDocument<InputShape>> & {
          modifications: InputDocument<InputShape>;
        };
      };
      returns: void | Promise<void>;
    };
  };
  delete: {
    pre: {
      details: {
        event: "delete";
        method: "deleteOne" | "deleteMany";
        filter: Filter<InputDocument<InputShape>>;
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
        filter: Filter<InputDocument<InputShape>>;
        replacement: InputDocument<InputShape>;
      };
      returns: InputDocument<InputShape> | Promise<InputDocument<InputShape>>;
    };
    post: {
      details: {
        event: "replace";
        method: "replaceOne";
        data:
          | InputDocument<InputShape>
          | UpdateResult<InputDocument<InputShape>>
          | Promise<
              | InputDocument<InputShape>
              | UpdateResult<InputDocument<InputShape>>
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

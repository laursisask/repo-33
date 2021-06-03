import type QueryStream from "pg-query-stream";

/**
 * Node readable streams don't have any notion of generics, which limits what
 * types pg-query-stream offers us. That's ok, we can extend the QueryStream
 * interface with a generic and recover that feature. Later, we will cast our
 * QueryStream into a TypedQueryStream and get everything we want.
 */
export interface TypedQueryStream<T> extends QueryStream {
  read(size?: number): T[] | null;

  // Have to redeclare all these. Lame:
  addListener(event: "close", listener: () => void): this;

  addListener(event: "data", listener: (chunk: T) => void): this;

  addListener(event: "end", listener: () => void): this;

  addListener(event: "error", listener: (err: Error) => void): this;

  addListener(event: "pause", listener: () => void): this;

  addListener(event: "readable", listener: () => void): this;

  addListener(event: "resume", listener: () => void): this;

  emit(event: "close"): boolean;

  emit(event: "data", chunk: T): boolean;

  emit(event: "end"): boolean;

  emit(event: "error", err: Error): boolean;

  emit(event: "pause"): boolean;

  emit(event: "readable"): boolean;

  emit(event: "resume"): boolean;

  on(event: "close", listener: () => void): this;

  on(event: "data", listener: (chunk: T) => void): this;

  on(event: "end", listener: () => void): this;

  on(event: "error", listener: (err: Error) => void): this;

  on(event: "pause", listener: () => void): this;

  on(event: "readable", listener: () => void): this;

  on(event: "resume", listener: () => void): this;

  once(event: "close", listener: () => void): this;

  once(event: "data", listener: (chunk: T) => void): this;

  once(event: "end", listener: () => void): this;

  once(event: "error", listener: (err: Error) => void): this;

  once(event: "pause", listener: () => void): this;

  once(event: "readable", listener: () => void): this;

  once(event: "resume", listener: () => void): this;

  prependListener(event: "close", listener: () => void): this;

  prependListener(event: "data", listener: (chunk: T) => void): this;

  prependListener(event: "end", listener: () => void): this;

  prependListener(event: "error", listener: (err: Error) => void): this;

  prependListener(event: "pause", listener: () => void): this;

  prependListener(event: "readable", listener: () => void): this;

  prependListener(event: "resume", listener: () => void): this;

  prependOnceListener(event: "close", listener: () => void): this;

  prependOnceListener(event: "data", listener: (chunk: T) => void): this;

  prependOnceListener(event: "end", listener: () => void): this;

  prependOnceListener(event: "error", listener: (err: Error) => void): this;

  prependOnceListener(event: "pause", listener: () => void): this;

  prependOnceListener(event: "readable", listener: () => void): this;

  prependOnceListener(event: "resume", listener: () => void): this;

  removeListener(event: "close", listener: () => void): this;

  removeListener(event: "data", listener: (chunk: T) => void): this;

  removeListener(event: "end", listener: () => void): this;

  removeListener(event: "error", listener: (err: Error) => void): this;

  removeListener(event: "pause", listener: () => void): this;

  removeListener(event: "readable", listener: () => void): this;

  removeListener(event: "resume", listener: () => void): this;

  // Narrow the type on the async iterator:
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

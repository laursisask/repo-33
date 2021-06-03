import { inspect } from "util";

function stringifyParameters(params: unknown[]) {
  return params
    .map((p, i) => `\n  $${i + 1}: ${typeof p} ${inspect(p)}`)
    .join("");
}

/**
 * An that occurred while running an SQL query.
 *
 * This captures the SQL and the parameters for easy debugging.
 */
export class SqlError extends Error {
  pgError?: Error;
  notices?: Error[];
  sql?: string;
  params?: unknown[];

  constructor(args: {
    sql?: string;
    params?: unknown[];
    pgError?: Error;
    notices?: Error[];
  }) {
    super();
    this.stack = this.pgError?.stack || this.stack;
    Object.assign(this, args);
  }

  get message(): string {
    return this.valueOf();
  }

  valueOf(): string {
    const notices = this.notices?.map?.((e) => `notice: ${e.message}`) || [];
    const errorsStr = [...notices, this.pgError?.message].join("\n");

    const paramsStr =
      this.params && this.params.length
        ? "\nQuery parameters:" + stringifyParameters(this.params)
        : "";

    return `SQL Error: ${errorsStr}\n${this.sql}${paramsStr}`;
  }
}

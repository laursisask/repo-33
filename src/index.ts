import pg, { Pool } from "pg";
import { parse as parseConnectionString } from "pg-connection-string";
import findRoot from "find-root";
import { readFileSync } from "fs";
import { inspect } from "util";

import {
  Literal,
  escapeIdentifier,
  escapeIdentifiers,
  escapeLiteral,
  escapeLiterals,
} from "./escape";
import {
  RawSql,
  TemplateArg,
  canGetRawSqlFrom,
  template,
  identifier,
  identifiers,
  items,
  literal,
  literals,
} from "./templating";
import { Transaction, RealTransaction } from "./transaction";

// Export these using ECMAScript modules. This is the preferred way to access
// these APIs.
export {
  Literal,
  escapeIdentifier,
  escapeIdentifiers,
  escapeLiteral,
  escapeLiterals,
  RawSql,
  TemplateArg,
  template,
  identifier,
  identifiers,
  items,
  literal,
  literals,
};

/**
 * An interface providing access to PostgreSQL.
 *
 * This is implemented by the `simple-postgres` module as a whole, but also by
 * by individual transactions.
 */
export interface Connection {
  /**
   * Run a query.
   *
   * This may be invoked as either:
   *
   *     query`UPDATE accounts SET enabled = ${enabled}`
   *
   * Or as:
   *
   *     query('UPDATE accounts SET enabled = $1', [enabled])
   */
  query<Row>(
    sql: TemplateStringsArray,
    ...params: TemplateArg[]
  ): Promise<pg.QueryResult<Row>>;
  query<Row>(sql: string, params?: Literal[]): Promise<pg.QueryResult<Row>>;
  query<Row>(sql: RawSql): Promise<pg.QueryResult<Row>>;

  /**
   * Run a query, returning the first column of the first row.
   *
   * This may be invoked as either:
   *
   *     value`SELECT first_name FROM people WHERE id = ${id}`
   *
   * Or as:
   *
   *     value('SELECT first_name FROM people where id = $1', [id])
   */
  value<Value>(
    sql: TemplateStringsArray,
    ...params: TemplateArg[]
  ): Promise<Value | undefined>;
  value<Value>(sql: string, params?: Literal[]): Promise<Value | undefined>;
  value<Value>(sql: RawSql): Promise<Value | undefined>;

  /**
   * Run a query, returning the first row as an object. This does not add
   * `LIMIT 1`, so if you want that, you'll need to do it yourself.
   *
   * This may be invoked as either:
   *
   *     row`SELECT * FROM people WHERE id = ${id}`
   *
   * Or as:
   *
   *     row('SELECT * FROM people where id = $1', [id])
   */
  row<Row>(
    sql: TemplateStringsArray,
    ...params: TemplateArg[]
  ): Promise<Row | undefined>;
  row<Row>(sql: string, params?: Literal[]): Promise<Row | undefined>;
  row<Row>(sql: RawSql): Promise<Row | undefined>;

  /**
   * Run a query, returning the matching rows.
   *
   * This may be invoked as either:
   *
   *     rows`SELECT * FROM people WHERE id = ${id}`
   *
   * Or as:
   *
   *     rows('SELECT * FROM people where id = $1', [id])
   */
  rows<Row>(
    sql: TemplateStringsArray,
    ...params: TemplateArg[]
  ): Promise<Array<Row>>;
  rows<Row>(sql: string, params?: Literal[]): Promise<Array<Row>>;
  rows<Row>(sql: RawSql): Promise<Array<Row>>;

  /**
   * Run a query. Returns a promise, which resolves with an array of the first
   * values in each row.
   *
   * ```
   * let oneThroughFive = await db.column('SELECT * FROM generate_series(1, 5)');
   * ```
   */
  column<Value>(
    sql: TemplateStringsArray,
    ...params: TemplateArg[]
  ): Promise<Array<Value>>;
  column<Value>(sql: string, params?: Literal[]): Promise<Array<Value>>;
  column<Value>(sql: RawSql): Promise<Array<Value>>;

  /**
   * Use a single connection from our database pool to run multiple queries.
   *
   * @param block A function. This will be passed a `Connection` object that
   * re-uses a single pool connection for all queries.
   */
  connection<Result>(
    block: (conn: Connection) => Promise<Result>
  ): Promise<Result>;

  /**
   * Perform a database transaction.
   *
   * Transactions can be nested. Internally, nesting uses savepoints.
   *
   * @param block A function to run inside the transaction. Should return a
   * promise. If the promise rejects, the transaction will be rolled back.
   */
  transaction<T>(block: (conn: Connection) => Promise<T>): Promise<T>;
}

/** APIs for easily working with PostgreSQL. */
export interface SimplePostgres extends Connection {
  /**
   * Alias of db.escapeLiteral. Escape a value for safe use in SQL queries,
   * returning a string.
   *
   * While this function is tested and probably secure, you should avoid using
   * it. Instead, use bind vars, as they are much more difficult to mess up.
   */
  escape(value: Literal): string;

  /**
   * Escape a value for safe use in SQL queries, returning a string.
   *
   * While this function is tested and probably secure, you should avoid using
   * it. Instead, use bind vars, as they are much more difficult to mess up.
   */
  escapeLiteral(value: Literal): string;

  /**
   * Escape `literals` using `separator`. Defaults to `", "`.
   *
   * While this function is tested and probably secure, you should avoid using
   * it. Instead, use bind vars, as they are much more difficult to mess up.
   */
  escapeLiterals(literals: Literal[], separator?: string): string;

  /**
   * Escape a value for safe use as an identifier in SQL queries. Returns
   * string.
   *
   * Prefer `identifier` instead.
   */
  escapeIdentifier(value: string): string;

  /**
   * Escape `idents` using `separator`. Defaults to `", "`.
   *
   * Prefer `identifiers` instead.
   */
  escapeIdentifiers(idents: string[], separator?: string): string;

  /**
   * Format an SQL fragment, escaping any values.
   *
   * ```
   * const tpl = db.template`SELECT ${[1, 2, 3]} AS ${db.identifier("a")}`;
   * ```
   *
   * ...would return raw SQL containing `'SELECT Array[1, 2, 3] AS "a"'`. This
   * could then be passed to other functions like `query` as embedded SQL.
   *
   * If you need to combine a series of templates, see `items`.
   */
  template(strings: TemplateStringsArray, ...values: TemplateArg[]): RawSql;

  /**
   * Escape a series of template items using `separator`. Defaults to `", "`.
   *
   * This is especially useful for combining the result of several calls to
   * `template`.
   */
  items(items: TemplateArg[], separator?: string): RawSql;

  /**
   * Specify that `ident` should be formatted as an SQL identifier.
   *
   * @param ident The identifier to format as SQL.
   */
  identifier(ident: string): RawSql;

  /**
   * Specify that `idents` should be formatted as a list of SQL identifiers.
   *
   * @param idents The identifiers to format as SQL.
   * @param separator The string with which to separate identifiers. Defaults to
   * `", "`.
   */
  identifiers(idents: string[], separator?: string): RawSql;

  /**
   * Specify that `literal` should be formatted as an SQL literal.
   */
  literal(literal: Literal): RawSql;

  /**
   * Specify that `literals` should be formatted as a list of SQL literals using
   * `separator`. Defaults to `", "`.
   */
  literals(literals: Literal[], separator?: string): RawSql;

  /**
   * Retrieve the underlying connection pool.
   */
  pool(): Promise<pg.Pool>;

  /**
   * Shut down our underlying connection pool.
   *
   * This is useful for cleaning up after running tests, or in a script.
   */
  end(): Promise<void>;

  /**
   * Sets a callback for otherwise unhandled errors such as dropped
   * connections and other mysteries.
   */
  setErrorHandler(callback: (e: Error) => void): void;
}

/**
 * An SQL query and any parameters that it requires.
 *
 * We support many different calling conventions, as you can see in
 * `Connection`, and we try to normalize them as soon as we get them from the
 * user in order to keep the rest of our code simple.
 */
type Query = {
  /** The SQL query. */
  sql: string;
  /** Query parameters. */
  params: Literal[];
};

/**
 * Convert the arguments of a template call into normalized format.
 */
function queryAndParamsForTemplate(
  strings: TemplateStringsArray,
  values: TemplateArg[]
): Query {
  const stringsLength = strings.length;
  const valuesLength = values.length;
  const maxLength = Math.max(stringsLength, valuesLength);
  let sql = "";
  const params: Literal[] = [];
  for (let i = 0; i < maxLength; i++) {
    if (i < stringsLength) {
      sql += strings[i];
    }
    if (i < valuesLength) {
      const val = values[i];
      if (canGetRawSqlFrom(val)) {
        sql += val.__unsafelyGetRawSql();
      } else {
        sql += "$" + params.push(val);
      }
    }
  }
  return { sql, params };
}

/**
 * A function which runs `work` with a `pg.PoolClient`.
 *
 * We abstract this away because the details change depending on whether we're
 * running normally, or inside `connection()`.
 */
type WithPoolClient = <Result>(
  work: (client: pg.PoolClient) => Promise<Result>
) => Promise<Result>;

/**
 * A class type that we use to implement `Connection`.
 *
 * Using a class behind the scenes simplifies things quite a bit.
 */
class ConnectionImpl {
  /**
   * A function which can be used to create a new database pool connection.
   *
   * Altenratively, this function is allowed to return the same connection over
   * and over again. We don't care how it works; that's somebody else's problem.
   */
  private withPoolClient: WithPoolClient;

  /** The current transaction, if any. */
  private currentTransaction: Transaction | null;

  /**
   * Construct a new `ConnectionImpl`.
   *
   * @param connect A function which can be used to create a new database pool connection.
   */
  constructor(
    withPoolClient: WithPoolClient,
    currentTransction: Transaction | null
  ) {
    this.withPoolClient = withPoolClient;
    this.currentTransaction = currentTransction;
  }

  /**
   * Our underlying query implementation, used by higher-level query functions.
   *
   * This is the internal version that takes a pre-normalized `Query`, not the
   * public version that takes a variety of different types. See `wrap`, below.
   */
  async query<Row>(
    client: pg.PoolClient,
    query: Query
  ): Promise<pg.QueryResult<Row>> {
    const stack = new Error().stack;

    const notices: Error[] = [];
    function onNotice(notice: Error) {
      notices.push(notice);
    }

    client.on("notice", onNotice);
    try {
      return await client.query(query.sql, query.params);
    } catch (err) {
      throw new SqlError(query.sql, query.params, stack, err, notices);
    } finally {
      client.removeListener("notice", onNotice);
    }
  }

  async rows<Row>(client: pg.PoolClient, query: Query): Promise<Array<Row>> {
    const result = await this.query<Row>(client, query);
    return result.rows;
  }

  async row<Row>(
    client: pg.PoolClient,
    query: Query
  ): Promise<Row | undefined> {
    const result = await this.query<Row>(client, query);
    return result.rows[0];
  }

  async value<Value>(
    client: pg.PoolClient,
    query: Query
  ): Promise<Value | undefined> {
    const row = await this.row<Record<string, Value>>(client, query);
    return row && row[Object.keys(row)[0]];
  }

  async column<Value>(
    client: pg.PoolClient,
    query: Query
  ): Promise<Array<Value>> {
    const result = await this.query<Record<string, Value>>(client, query);
    if (result.rows.length === 0) {
      return [];
    } else {
      const col = Object.keys(result.rows[0])[0];
      return result.rows.map((row) => row[col]);
    }
  }

  /**
   * Get a single method from our pool and reuse it for multiple queries.
   *
   * The `trx` argument will become the current transaction of the nested
   * connection. We don't include `trx` in the export type for this function.
   */
  async connection<Result>(
    work: (conn: Connection) => Promise<Result>,
    trx: Transaction | null = this.currentTransaction
  ): Promise<Result> {
    return this.withPoolClient(async (client) => {
      const withPoolClient: WithPoolClient = (smallerWork) =>
        smallerWork(client);
      const impl = new ConnectionImpl(withPoolClient, trx);
      return work(impl.wrap());
    });
  }

  /** Create a new transaction. */
  transaction<Result>(
    work: (connection: Connection) => Promise<Result>
  ): Promise<Result> {
    // Create an appropriate `Transaction` object. This may actually be a
    // savepoint, but we don't have to care about that.
    let trx: Transaction;
    if (this.currentTransaction) {
      trx = this.currentTransaction.newChildTransaction();
    } else {
      trx = new RealTransaction();
    }

    // Use `connection` to make sure we have a consistent connection for all the
    // statements in this transaction.
    return this.connection(async (conn) => {
      let result: Result;
      let inTransaction: boolean = false;

      try {
        await conn.query(trx.beginStatement());
        inTransaction = true;
        const _result = await work(conn);
        result = _result;
        await conn.query(trx.commitStatement());
        return result;
      } catch (err) {
        if (!inTransaction) throw err;
        try {
          await conn.query(trx.rollbackStatement());
        } catch (rollbackErr) {
          const errVal =
            err instanceof Error ? err.message + "\n" + err.stack : err;
          const rollbackErrVal =
            rollbackErr instanceof Error
              ? rollbackErr.message + "\n" + rollbackErr.stack
              : rollbackErr;
          const bigErr = new Error(
            "Failed to execute rollback after error\n" +
              errVal +
              "\n\n" +
              rollbackErrVal
          );
          (bigErr as AbortConnectionError).ABORT_CONNECTION = true;
          throw bigErr;
        }
        throw err;
      }
    }, trx);
  }

  /**
   * Wrap this `ConnectionImpl` up so that it fulfills the contract of our
   * public `Connection` type.
   *
   * This allows us to have a class-based implementation, but we can also
   * preserve the very nice public interface to this module.
   */
  wrap(): Connection {
    const withPoolClient = this.withPoolClient;

    /** The shape of a function like `query<Result>` once we wrap it. */
    interface WrappedFn<Result> {
      (sql: TemplateStringsArray, ...params: TemplateArg[]): Promise<Result>;
      (sql: string, params?: Literal[]): Promise<Result>;
      (sql: RawSql): Promise<Result>;
    }

    /**
     * Wrap a bound class method so that it works with any of the `WrappedFn`
     * calling conventions.
     */
    function wrapFn<Result>(
      f: (client: pg.PoolClient, query: Query) => Promise<Result>
    ): WrappedFn<Result> {
      // A wrapper function which figures out which of three legal signatures we
      // were called with and casts our types appropriately. Be sure this logic
      // matches `WrappedFn` above!
      return function (
        sql: TemplateStringsArray | string | RawSql,
        ...params: unknown[]
      ): Promise<Result> {
        return withPoolClient((client) => {
          if (typeof sql === "string") {
            // We have a string query and all our args in `params[0]`.
            return f(client, { sql, params: params[0] as Literal[] });
          } else if (canGetRawSqlFrom(sql)) {
            return f(client, {
              sql: sql.__unsafelyGetRawSql(),
              params: [],
            });
          } else {
            // We have a `TemplateStringsArray` and our args in `params`.
            const query = queryAndParamsForTemplate(
              sql,
              params as TemplateArg[]
            );
            return f(client, query);
          }
        });
      };
    }

    return {
      query: wrapFn(this.query.bind(this)),
      rows: wrapFn(this.rows.bind(this)),
      row: wrapFn(this.row.bind(this)),
      value: wrapFn(this.value.bind(this)),
      column: wrapFn(this.column.bind(this)),
      connection: this.connection.bind(this),
      transaction: this.transaction.bind(this),
    };
  }
}

/**
 * An that occurred while running an SQL query.
 *
 * This captures the SQL and the parameters for easy debugging.
 */
export class SqlError extends Error {
  constructor(
    sql: string,
    params: TemplateArg[],
    stack: string | undefined,
    pgError: Error,
    notices: Error[]
  ) {
    super();
    Object.assign(this, pgError);
    this.name = "SqlError";
    const noticesStr = [
      ...notices.map((e) => `notice: ${e.message}`),
      pgError.message,
    ].join("\n");
    const paramsStr =
      params && params.length
        ? "\nQuery parameters:" + stringifyParameters(params)
        : "";
    this.message = `SQL Error: ${noticesStr}\n${sql}${paramsStr}`;
    this.stack = this.message + "\n";
    if (stack != null) this.stack += stack.replace(/^.+\n/, "");
  }
}

function stringifyParameters(params: unknown[]) {
  return params
    .map((p, i) => `\n  $${i + 1}: ${typeof p} ${inspect(p)}`)
    .join("");
}

/**
 * An error so bad that we need to drop the database connection completely.
 *
 * This normally happens when transactional rollback fails. This is not actually
 * a subclass of `Error`, but rather a _type_ that any instance of `Error` might
 * or might not belong to.
 */
type AbortConnectionError = Error & { ABORT_CONNECTION: true };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAbortConnectionError(err: any): err is AbortConnectionError {
  return (
    err instanceof Error &&
    "ABORT_CONNECTION" in err &&
    err["ABORT_CONNECTION"] === true
  );
}

/** A connection from our connect pool, and a function to release it. */
type PoolClientAndRelease = [
  pg.PoolClient,
  (err?: boolean | Error | undefined) => void
];

/** Run work using `connection` and release the connection to the pool. */
async function withConnection<T>(
  connection: Promise<PoolClientAndRelease>,
  work: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const [client, release] = await connection;
  try {
    const result = await work(client);
    release();
    return result;
  } catch (err) {
    if (isAbortConnectionError(err)) {
      // this is a really bad one, remove the connection from the pool
      release(err);
    } else {
      release();
    }
    throw err;
  }
}

function getApplicationName(): string | undefined {
  const path = findRoot(process.argv[1] || process.cwd()) + "/package.json";
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  return pkg.name;
}

/**
 * Configuration options for `simple-postgres`.
 *
 * HACK: We include both `pg.PoolConfig` and `pg.Defaults`, because the type
 * declarations say `pg.PoolConfig` and the docs show values for `pg.Defaults`.
 */
export interface Config extends pg.PoolConfig, pg.Defaults {
  errorHandler?: (err: Error, client?: pg.PoolClient) => void;
  debug_postgres?: boolean;
}

/** Given a Postgres URL, construct a `Config`. */
export function configFromUrl(url: string): Config {
  const connOpts = parseConnectionString(url);
  const parsedQuery = new URL(url).searchParams; // add query parameters

  function queryStr(paramName: string): string | undefined {
    const value = parsedQuery.get(paramName);
    return value != null ? value : undefined;
  }

  function queryBool(paramName: string): boolean | undefined {
    const s = queryStr(paramName);
    if (s == null) return s;
    return s !== "false";
  }

  function queryNum(paramName: string): number | undefined {
    const s = queryStr(paramName);
    if (s == null) return s;
    return Number(s);
  }

  return {
    // From connOpts.
    host: connOpts.host || undefined,
    password: connOpts.password,
    user: connOpts.user,
    port: connOpts.port != null ? Number(connOpts.port) : undefined,
    database: connOpts.database || undefined,
    // TODO: Support more SSL options.
    ssl: connOpts.ssl ? true : false,
    application_name: connOpts.application_name,

    // From our URL string.
    connectionString: queryStr("connectionString"),
    keepAlive: queryBool("keepAlive"),
    statement_timeout: queryNum("statement_timeout"),
    parseInputDatesAsUTC: queryBool("parseInputDatesAsUTC"),
    query_timeout: queryNum("query_timeout"),
    keepAliveInitialDelayMillis: queryNum("keepAliveInitialDelayMillis"),
    idle_in_transaction_session_timeout: queryNum(
      "idle_in_transaction_session_timeout"
    ),
    max: queryNum("max"),
    min: queryNum("min"),
    connectionTimeoutMillis: queryNum("connectionTimeoutMillis"),
    idleTimeoutMillis: queryNum("idleTimeoutMillis"),

    // These aren't accepted according to the type declarations, but I've seen
    // some of them in the docs. They correspond to `pg.Defaults`.
    poolSize: queryNum("poolSize"),
    poolIdleTimeout: queryNum("poolIdleTimeout"),
    reapIntervalMillis: queryNum("reapIntervalMillis"),
    binary: queryBool("binary"),
    parseInt8: queryBool("parseInt8"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
function DO_NOTHING() {}

/**
 * Configure a `simple-postgres` instance.
 *
 * @param urlOrConfig Either a `postgres://` URL, or a set of configuration
 * options.
 */
export function configure(urlOrConfig?: string | Config): SimplePostgres {
  // Figure out our configuration.
  let config: Config;
  if (typeof urlOrConfig === "string") {
    config = configFromUrl(urlOrConfig);
  } else if (typeof urlOrConfig === "undefined") {
    // I'm not even sure if this is useful or correct, but this is the code path
    // we've always taken when `process.env.DATABASE_URL` is not defined.
    config = {};
  } else {
    config = urlOrConfig;
  }

  // Default some things in a mostly backwards-compatible way.
  if (config.poolSize == null && process.env.PG_POOL_SIZE) {
    config.poolSize = Number(process.env.PG_POOL_SIZE);
  }
  if (config.max == null && config.poolSize != null) {
    config.max = config.poolSize;
  }
  if (config.idleTimeoutMillis == null) {
    if (process.env.PG_IDLE_TIMEOUT != null) {
      config.idleTimeoutMillis = Number(process.env.PG_IDLE_TIMEOUT);
    } else if (process.env.NODE_ENV === "test") {
      config.idleTimeoutMillis = 1;
    }
  }
  if (!config.application_name) {
    config.application_name =
      process.env.APPLICATION_NAME || getApplicationName();
  }
  let handleError = config.errorHandler || DO_NOTHING;
  function setErrorHandler(handler: Config["errorHandler"]) {
    handleError = handler || DO_NOTHING;
  }
  if (config.debug_postgres || process.env.DEBUG_POSTGRES) {
    const defaultLog = config.log || DO_NOTHING;
    config.log = function debugLog(...args) {
      console.debug("simple-postgres debug", ...args);
      defaultLog(...args);
    };
  }

  // Lazy initialization of our Promise pool.
  let _pool: Promise<pg.Pool> | undefined;
  function pool() {
    if (!_pool) {
      _pool = new Promise((resolve) => {
        const p = new Pool(config);
        p.on("error", (...args) => handleError(...args));
        resolve(p);
      });
    }
    return _pool;
  }

  async function end() {
    if (_pool) {
      const p = await _pool;
      await p.end();
      _pool = undefined;
    }
  }

  /** Fetch a connection from our pool. */
  async function connect(): Promise<PoolClientAndRelease> {
    type CustomClient = pg.PoolClient & { __simplePostgresOnError?: true };

    // TODO: allow returning just the client, not the tuple of client + release fn
    const p = await pool();
    const client = await p.connect();
    if (
      typeof (client as CustomClient).__simplePostgresOnError === "undefined"
    ) {
      (client as CustomClient).__simplePostgresOnError = true;
      client.on("error", handleError);
    }
    return [client, client.release.bind(client)];
  }

  // Set up our "base" `ConnectionImpl`, which will get a `pg.PoolClient` from
  // the pool before every single SQL statement. This contrasts with
  // `connection` below, which reuses one `pg.PoolClient` for multiple queries.
  const withPoolClient: WithPoolClient = (work) =>
    withConnection(connect(), work);
  const connection = new ConnectionImpl(withPoolClient, null).wrap();

  // Build a `SimplePostgres` value. This isn't a real class, mostly for reasons
  // of backwards compatibility.
  return {
    // Include all the wrapped methods from our "base" `ConnectionImpl`.
    ...connection,

    // Provide access to our pool and error handler.
    pool,
    end,
    setErrorHandler,

    // These are mostly included here for reasons of backwards compatibility. It
    // would be better for callers to import them as regular ECMAScript module
    // items instead.
    escape: escapeLiteral,
    escapeLiteral,
    escapeLiterals,
    escapeIdentifier,
    escapeIdentifiers,
    template,
    items,
    identifier,
    identifiers,
    literal,
    literals,
  };
}

export default {
  ...configure(process.env.DATABASE_URL),
  // For backwards compatibility with the old days.
  configure,
  SqlError,
};

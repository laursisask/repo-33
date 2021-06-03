import { PoolClient, QueryConfig, QueryResult } from "pg";
import { sql, SqlLiteralParams, SqlQueryObject } from "selectstar";
import { SqlError } from "./SqlError";
import { RealTransaction, Transaction } from "./Transaction";
import { TypedQueryStream } from "./TypedQueryStream";
import type QueryStreamType from "pg-query-stream";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface QueryResultRow {}

/**
 * This is a bit of a shorthand. We don't want to import the QueryStream
 * instance if we don't have to. Instead, we assume that anything that obeys the
 * node-postgres "submittable" interface is a QueryStream object. That doesn't
 * always need to be strictly true, but cases where it is not are outside of
 * our approved use cases.
 *
 * @param value
 */
function isQueryStream(value: unknown): value is QueryStreamType {
  return typeof value === "object" && value !== null && "submit" in value;
}

/**
 * node-postgres can accept a SqlQueryObject which is an object of two
 * properties: text, and values. Text is the parameterized query string and
 * values is an array of values, one value for each parameter in order.
 *
 * @param value
 */
function isSqlQueryObject(value: unknown): value is SqlQueryObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    "values" in value
  );
}

/**
 * An error so bad that we need to drop the database connection completely.
 *
 * This normally happens when transactional rollback fails. This is not actually
 * a subclass of `Error`, but rather a _type_ that any instance of `Error` might
 * or might not belong to.
 */
type AbortConnectionError = Error & { ABORT_CONNECTION: true };

export function isAbortConnectionError(
  err: unknown
): err is AbortConnectionError {
  return (
    err instanceof Error &&
    "ABORT_CONNECTION" in err &&
    err["ABORT_CONNECTION"] === true
  );
}

export type WithPoolClient = <Result>(
  work: (client: PoolClient) => Promise<Result>
) => Promise<Result>;

/**
 * A Connection is the base unit of interacting with a postgres database within
 * simple-postgres.
 *
 * It doesn't know anything about the underlying connection, really, except
 * that it is given a function that takes a unit of work and evaluates it
 * against a particular database connection, and optionally some metadata about
 * the current transaction. Developers should never have to instantiate a
 * Connection object themselves, except perhaps during testing.
 */
export class Connection {
  private readonly withClient: WithPoolClient;
  private readonly tx: Transaction | null;

  constructor(withClient: WithPoolClient, tx?: Transaction) {
    this.withClient = withClient;
    this.tx = tx ?? null;
  }

  // Our private place where we interact with the database. All queries go
  // through this method. It does some work to make error handling better.
  private async _query<Row>(qs: QueryStreamType): Promise<QueryStreamType>;
  private async _query<Row>(config: QueryConfig): Promise<QueryResult<Row>>;
  private async _query<Row>(
    config: QueryConfig | QueryStreamType
  ): Promise<QueryResult<Row> | QueryStreamType> {
    return this.withClient(async (client) => {
      const notices: Error[] = [];

      // Note that if you send multiple queries to the same client, they may both
      // receive a notice.
      //
      // TODO: should queries to clients be queued (perhaps only in dev mode) so
      //       that they are associated with the right query? Potentially a huge
      //       performance cost for some clarity gains.
      //
      function onNotice(notice: Error) {
        notices.push(notice);
      }

      client.on("notice", onNotice);
      try {
        if (isQueryStream(config)) {
          return await client.query(config);
        } else {
          return await client.query<Row>(config);
        }
      } catch (err) {
        const { text, values } = isQueryStream(config) ? config.cursor : config;
        throw new SqlError({
          sql: text,
          params: values,
          pgError: err,
          notices: notices,
        });
      } finally {
        client.removeListener("notice", onNotice);
      }
    });
  }

  /**
   * Given a query that returns a single column, return a promise wrapping an
   * array of that column. The method does not enforce that a single column
   * should be queried, so it is possible to over-fetch data and receive
   * inconsistent results.
   *
   * @param query
   */
  async column<Column>(query: SqlQueryObject): Promise<Column[]>;
  async column<Column>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<Column[]>;
  async column<Column>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[]
  ): Promise<Column[]> {
    // Spurious cast, but should be entirely safe.
    const result = await this.query<Record<string, Column>>(
      query as TemplateStringsArray,
      ...params
    );
    if (result.rows.length === 0) {
      return [];
    } else {
      const col = Object.keys(result.rows[0])[0];
      return result.rows.map((row) => row[col]);
    }
  }

  /**
   * Given a unit of work, run it on the currently-bound client connection.
   * @param block
   */
  async connection<Result>(
    block: (conn: Connection) => Promise<Result>
  ): Promise<Result> {
    return this.withClient((client) => {
      const conn = new Connection((work) => work(client));
      return block(conn);
    });
  }

  /**
   * Run a sql query and return the raw result from Postgres
   *
   * @param query
   */
  async query<Row extends QueryResultRow = any>(
    query: SqlQueryObject
  ): Promise<QueryResult<Row>>;
  async query<Row extends QueryResultRow = any>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<QueryResult<Row>>;
  async query<Row extends QueryResultRow = any>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[]
  ): Promise<QueryResult<Row>> {
    if (isSqlQueryObject(query)) {
      return this._query<Row>(query as SqlQueryObject);
    } else {
      return this._query<Row>(sql(query, ...params));
    }
  }

  /**
   * Given a query that returns a single row, return a promise wrapping that
   * single row result. The method does not enforce that a single row should be
   * returned, so it is possible to over-fetch data and receive inconsistent
   * results.
   *
   * @param query
   */
  async row<Row extends QueryResultRow = any>(
    query: SqlQueryObject
  ): Promise<Row | undefined>;
  async row<Row extends QueryResultRow = any>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<Row | undefined>;
  async row<Row extends QueryResultRow = any>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[] | []
  ): Promise<Row | undefined> {
    // Spurious cast, but should be entirely safe.
    const result = await this.query<Row>(
      query as TemplateStringsArray,
      ...params
    );
    return result.rows[0];
  }

  /**
   * Given a query that returns a collection of values, run the query and return
   * the values. In contrast to `.query`, which returns the raw Postgres sql
   * result object, this just returns the row values.
   *
   * @param query
   */
  async rows<Row extends QueryResultRow = any>(
    query: SqlQueryObject
  ): Promise<Row[]>;
  async rows<Row extends QueryResultRow = any>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<Row[]>;
  async rows<Row extends QueryResultRow = any>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[]
  ): Promise<Row[]> {
    // Spurious cast, but should be entirely safe.
    const result = await this.query<Row>(
      query as TemplateStringsArray,
      ...params
    );
    return result.rows;
  }

  /**
   * Given a query that returns a collection of values, run the query and return
   * a stream of the resulting objects. This uses the pg-query-stream library
   * under the hood and that dependency must be installed for this method to
   * work.
   *
   * The returned stream is a NodeJS ReadableStream, so obeys the AsyncIterator
   * contract, allowing you to use `for await (const row of queryStream)`
   *
   * @param query
   */
  async stream<Row extends QueryResultRow = any>(
    query: SqlQueryObject
  ): Promise<TypedQueryStream<Row>>;
  async stream<Row extends QueryResultRow = any>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<TypedQueryStream<Row>>;
  async stream<Row extends QueryResultRow = any>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[]
  ): Promise<TypedQueryStream<Row>> {
    // Doing a dynamic import here because pg-query-stream is optional. Don't
    // import it if we aren't using query streaming.
    //
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const QueryStream = require("pg-query-stream");

    const { text, values } = isSqlQueryObject(query)
      ? query
      : sql(query, ...params);
    const qs: QueryStreamType = new QueryStream(text, values);

    await this._query(qs);

    // Cast to our subtype of query stream that supports generics:
    return qs as TypedQueryStream<Row>;
  }

  /**
   * Start a transaction on the current connection and then evaluate the block
   * of work passed to this function. If the block of work returns successfully,
   * the transaction is committed to the database. If it throws an error, the
   * transaction is rolled back.
   *
   * For subordinate transactions--transactions within transactions--savepoints
   * are used instead.
   *
   * @param block
   */
  transaction<Result>(
    block: (conn: Connection) => Promise<Result>
  ): Promise<Result> {
    const tx = this.tx?.newChildTransaction() ?? new RealTransaction();

    return this.withClient(async (client) => {
      const conn = new Connection((work) => work(client), tx);
      let inTransaction = false;

      try {
        await conn.query`${tx.beginStatement()}`;
        inTransaction = true;
        const result = await block(conn);
        await conn.query`${tx.commitStatement()}`;

        return result;
      } catch (err) {
        if (!inTransaction) throw err;

        try {
          await conn.query`${tx.rollbackStatement()}`;
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
    });
  }

  /**
   * Given a query that returns a single row with a single column, return a
   * promise wrapping that single value result. This method does not enforce
   * the result be a single row or a single column, so over-fetching may produce
   * inconsistent results.
   *
   * @param query
   */
  async value<Value>(query: SqlQueryObject): Promise<Value>;
  async value<Value>(
    query: TemplateStringsArray,
    ...params: SqlLiteralParams[]
  ): Promise<Value>;
  async value<Value>(
    query: TemplateStringsArray | SqlQueryObject,
    ...params: SqlLiteralParams[]
  ): Promise<Value | undefined> {
    // Spurious cast, but should be entirely safe.
    const row = await this.row<Record<string, Value>>(
      query as TemplateStringsArray,
      ...params
    );
    return row && row[Object.keys(row)[0]];
  }
}

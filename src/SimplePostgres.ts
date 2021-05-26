import { Pool } from "pg";
import { getApplicationName, getConfigFromUrl } from "./configure";
import { Connection, isAbortConnectionError } from "./Connection";

export class SimplePostgres extends Connection {
  private readonly getPool: () => Pool;

  constructor(getPool: () => Pool) {
    super(async (work) => {
      const client = await this.pool.connect();

      try {
        const result = await work(client);
        client.release();
        return result;
      } catch (e) {
        if (isAbortConnectionError(e)) {
          // this is a really bad one, remove the connection from the pool
          client.release(e);
        } else {
          client.release();
        }
        throw e;
      }
    });
    this.getPool = getPool;
  }

  get pool(): Pool {
    return this.getPool();
  }

  /**
   * Backwards compatibility.
   *
   * Close the underlying postgres pool this instance of SimplePostgres is
   * using. Alternatively `instance.pool.end()`
   */
  async end(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Factory function: generate an instance of SimplePostgres from the
   * DATABASE_URL environment variable. Converts query arguments in the URL into
   * parameters for the database pool.
   *
   * The database pool is instantiated lazily.
   */
  static fromEnvironment(): SimplePostgres {
    let pool: Pool;
    return new SimplePostgres(() => {
      if (pool) return pool;

      if (!process.env.DATABASE_URL) throw new RangeError("Cannot create");

      const config = getConfigFromUrl(process.env.DATABASE_URL);

      // Set application name if it hasn't been set already
      config.application_name = config.application_name ?? getApplicationName();

      pool = new Pool(config);
      return pool;
    });
  }

  /**
   * Factory function: generate an instance of SimplePostgres from the provided
   * URL. Converts query argumetns in the URL into parameters for the database
   * pool.
   *
   * The database pool is instantiated eagerly.
   *
   * @param url
   */
  static fromUrl(url: string): SimplePostgres {
    const config = getConfigFromUrl(url);

    // Set application name if it hasn't been set already
    config.application_name = config.application_name ?? getApplicationName();

    const pool = new Pool(config);
    return new SimplePostgres(() => pool);
  }

  /**
   * Factory function: generate an instance of SimplePostgres with the provided
   * Postgres Pool instance.
   *
   * @param pool
   */
  static fromPool(pool: Pool): SimplePostgres {
    return new SimplePostgres(() => pool);
  }
}

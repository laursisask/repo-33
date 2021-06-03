import { Pool, PoolConfig } from "pg";
import { SimplePostgres } from "./SimplePostgres";

/**
 * Backwards compatibility: create a simple-postgres instance given a url or
 * configuration object.
 *
 * @param urlOrConfig
 */
export function configure(urlOrConfig: string | PoolConfig): SimplePostgres {
  if (typeof urlOrConfig === "string") {
    return SimplePostgres.fromUrl(urlOrConfig);
  } else {
    return SimplePostgres.fromPool(new Pool(urlOrConfig));
  }
}
export { SimplePostgres };
export default SimplePostgres.fromEnvironment();
export { Connection } from "./Connection";
export { SqlError } from "./SqlError";
export * from "selectstar";

import findRoot from "find-root";
import { readFileSync } from "fs";
import { PoolConfig } from "pg";
import { parse as parseConnectionString } from "pg-connection-string";

/** Given a Postgres URL, construct a pool configuration */
export function getConfigFromUrl(url: string): PoolConfig {
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
    max: queryNum("max") || queryNum("poolSize"), // backwards compatibility
    min: queryNum("min"),
    connectionTimeoutMillis: queryNum("connectionTimeoutMillis"),
    idleTimeoutMillis: queryNum("idleTimeoutMillis"),
  };
}

export function getApplicationName(): string | undefined {
  try {
    const path = findRoot(process.argv[1] || process.cwd()) + "/package.json";
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    return pkg.name;
  } catch (e) {
    return undefined;
  }
}

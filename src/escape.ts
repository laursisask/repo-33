// from https://github.com/brianc/node-postgres/blob/master/lib/client.js
// ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
// non-string handling added

/**
 * Escape a value for safe use as an identifier in SQL queries. Returns
 * string.
 *
 * Prefer `identifier` instead.
 */
export function escapeIdentifier(str: string): string {
  let escaped = '"';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') {
      escaped += c + c;
    } else {
      escaped += c;
    }
  }
  escaped += '"';
  return escaped;
}

/**
 * Escape `idents` using `separator`. Defaults to `", "`.
 *
 * Prefer `identifiers` instead.
 */
export function escapeIdentifiers(
  idents: string[],
  separator: string = ", "
): string {
  return idents.map(escapeIdentifier).join(separator);
}

/**
 * A literal value which can be escaped as valid SQL.
 */
export type Literal = string | number | boolean | Date | null | Literal[];

/**
 * Escape a value for safe use in SQL queries, returning a string.
 *
 * While this function is tested and probably secure, you should avoid using
 * it. Instead, use bind vars, as they are much more difficult to mess up.
 */
export function escapeLiteral(str: Literal): string {
  if (typeof str === "number") {
    return String(str);
  } else if (str === null) {
    return "null";
  } else if (str === true) {
    return "true";
  } else if (str === false) {
    return "false";
  } else if (Array.isArray(str)) {
    return "Array[" + str.map(escapeLiteral).join(", ") + "]";
  } else if (str instanceof Date) {
    // Convert dates to ISO 8601 strings then process normally.
    str = str.toISOString();
  }

  let hasBackslash = false;
  let escaped = "'";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "'") {
      escaped += c + c;
    } else if (c === "\\") {
      escaped += c + c;
      hasBackslash = true;
    } else {
      escaped += c;
    }
  }
  escaped += "'";
  if (hasBackslash === true) {
    escaped = " E" + escaped;
  }
  return escaped;
}

/**
 * Escape `literals` using `separator`. Defaults to `", "`.
 *
 * While this function is tested and probably secure, you should avoid using
 * it. Instead, use bind vars, as they are much more difficult to mess up.
 */
export function escapeLiterals(
  literals: Literal[],
  separator: string = ", "
): string {
  return literals.map(escapeLiteral).join(separator);
}

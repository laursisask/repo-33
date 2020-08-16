// Utilities that allow the user to safely insert SQL fragments directly into
// the query they're building.

import {
  Literal,
  escapeIdentifier,
  escapeIdentifiers,
  escapeLiteral,
  escapeLiterals,
} from "./escape";

/**
 * An internal type representing a value that can be converted to raw SQL.
 *
 * This is basically how we represent a "safe" fragment of SQL that was built up
 * from scratch.
 */
export interface RawSql {
  /** Internal function to get the raw SQL. */
  __unsafelyGetRawSql(): string;
}

/**
 * Does `v` appear to be a RawSql value? We use a return type of `v is RawSql`,
 * which makes the answer visible to TypeScript.
 */
export function canGetRawSqlFrom(v: unknown): v is RawSql {
  return (
    typeof v === "object" &&
    v !== null &&
    "__unsafelyGetRawSql" in v &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (v as any)["__unsafelyGetRawSql"] === "function" &&
    Object.keys(v).length === 1
  );
}

/** A value that can be interpolated into an SQL template. */
export type TemplateArg = Literal | RawSql;

/**
 * Specify that `ident` should be formatted as an SQL identifier.
 *
 * @param ident The identifier to format as SQL.
 */
export function identifier(value: string): RawSql {
  value = escapeIdentifier(value);
  return {
    __unsafelyGetRawSql() {
      return value;
    },
  };
}

/**
 * Specify that `idents` should be formatted as a list of SQL identifiers.
 *
 * @param idents The identifiers to format as SQL.
 * @param separator The string with which to separate identifiers. Defaults to
 * `", "`.
 */
export function identifiers(identifiers: string[], separator?: string): RawSql {
  const value = escapeIdentifiers(identifiers, separator);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return value;
    },
  };
}

/**
 * Specify that `literal` should be formatted as an SQL literal.
 */
export function literal(value: Literal): RawSql {
  const escaped = escapeLiteral(value);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return escaped;
    },
  };
}

/**
 * Specify that `literals` should be formatted as a list of SQL literals using
 * `separator`. Defaults to `", "`.
 */
export function literals(literals: Literal[], separator?: string): RawSql {
  const value = escapeLiterals(literals, separator);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return value;
    },
  };
}

/**
 * Escape a series of template items using `separator`. Defaults to `", "`.
 *
 * This is especially useful for combining the result of several calls to
 * `template`.
 */
export function items(items: TemplateArg[], separator?: string): RawSql {
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return items
        .map((v) =>
          canGetRawSqlFrom(v) ? v.__unsafelyGetRawSql() : escapeLiteral(v)
        )
        .join(separator || ", ");
    },
  };
}

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
export function template(
  strings: TemplateStringsArray,
  ...values: TemplateArg[]
): RawSql {
  const stringsLength = strings.length;
  const valuesLength = values.length;
  const maxLength = Math.max(stringsLength, valuesLength);

  return {
    __unsafelyGetRawSql() {
      let sql = "";
      for (let i = 0; i < maxLength; i++) {
        if (i < stringsLength) {
          sql += strings[i];
        }
        if (i < valuesLength) {
          const v = values[i];
          if (canGetRawSqlFrom(v)) {
            sql += v.__unsafelyGetRawSql();
          } else {
            sql += escapeLiteral(v);
          }
        }
      }
      return sql;
    },
  };
}

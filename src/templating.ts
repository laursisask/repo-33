// Utilities that allow the user to safely insert SQL fragments directly into
// the query they're building.

import * as escape from "./escape";

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

/**
 * An SQL bind parameter.
 *
 * It's important that this should never include any `Promise` type.
 */
export type TemplateArg = escape.Literal | RawSql;

export function templateIdentifier(value: string): RawSql {
  value = escape.identifier(value);
  return {
    __unsafelyGetRawSql() {
      return value;
    },
  };
}

export function templateIdentifiers(
  identifiers: string[],
  separator?: string
): RawSql {
  const value = escape.identifiers(identifiers, separator);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return value;
    },
  };
}

export function templateLiteral(value: escape.Literal): RawSql {
  const escaped = escape.literal(value);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return escaped;
    },
  };
}

export function templateLiterals(
  literals: escape.Literal[],
  separator?: string
): RawSql {
  const value = escape.literals(literals, separator);
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return value;
    },
  };
}

/**
 * Combine several items into one `RawSql` fragment safely. Useful with
 * `template`.
 */
export function templateItems(
  items: TemplateArg[],
  separator?: string
): RawSql {
  return {
    __unsafelyGetRawSql: function __unsafelyGetRawSql() {
      return items
        .map((v) =>
          canGetRawSqlFrom(v) ? v.__unsafelyGetRawSql() : escape.literal(v)
        )
        .join(separator || ", ");
    },
  };
}

/**
 * Render a template directly to `RawSql`. Useful for recursively constructing
 * SQL.
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
            sql += escape.literal(v);
          }
        }
      }
      return sql;
    },
  };
}

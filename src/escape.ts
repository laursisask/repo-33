// from https://github.com/brianc/node-postgres/blob/master/lib/client.js
// ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
// non-string handling added

export function identifier(str: string): string {
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

export function identifiers(
  identifiers: string[],
  separator: string = ", "
): string {
  return identifiers.map(identifier).join(separator);
}

export type Literal = string | number | boolean | null | Literal[];

export function literal(str: Literal): string {
  if (typeof str === "number") {
    return String(str);
  } else if (str === null) {
    return "null";
  } else if (str === true) {
    return "true";
  } else if (str === false) {
    return "false";
  } else if (Array.isArray(str)) {
    return "Array[" + str.map(literal).join(", ") + "]";
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

export function literals(
  literals: Literal[],
  separator: string = ", "
): string {
  return literals.map(literal).join(separator);
}

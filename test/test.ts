import assert from "assert";
import pg, { Pool } from "pg";

import test from "blue-tape";
import db, {
  configure,
  configFromUrl,
  escapeIdentifier,
  escapeIdentifiers,
  escapeLiteral,
  escapeLiterals,
  template,
  identifier,
  identifiers,
  items,
  literal,
  literals,
} from "../src";

/** How many connections are currently in this pool? */
function countConnections(pool: Pool) {
  return pool.totalCount;
}

/** HACK: Destroy connections out from under our pool. */
function destroyConnections(pool: Pool) {
  // break things by destroying all connections everywhere
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (pool as any)._clients.map((c: pg.Client) => c.end());
}

/**
 * Escape string for use in a regex.
 *
 * From
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#Escaping
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

// test("cancel", async (t) => {
//   let q = db.query("SELECT pg_sleep(10)");
//   let err;
//   q.then((val) => t.fail("pg_sleep should be cancelled")).catch((e) => {
//     err = e;
//   });
//   await q.cancel();
//   t.ok(err instanceof db.Cancel, "query should be cancelled");
// });

test("db.connection", async (t) => {
  await db.connection(async function ({ query, value }) {
    await query("SET statement_timeout=123456789");
    await db.query("RESET statement_timeout");
    t.equal(
      await value("SHOW statement_timeout"),
      "123456789ms",
      "should use the same connection"
    );
  });
});

// test("db.connection cancel", async (t) => {
//   await db.connection(async function ({ query, value }) {
//     let q = db.query("SELECT pg_sleep(10)");
//     let err;
//     q.then((val) => t.fail("pg_sleep should be cancelled")).catch((e) => {
//       err = e;
//     });
//     await q.cancel();
//     t.ok(err instanceof db.Cancel, "query should be cancelled");
//   });
// });

test("db.query", async (t) => {
  const result = await db.query("select * from generate_series(1, 3) g");
  t.equal(result.rowCount, 3, "should return result with rowCount property");
  t.equal(
    result.command,
    "SELECT",
    "should return result with command property"
  );
  t.ok(Array.isArray(result.rows), "should return result with rows property");
});

test("db.query (template string)", async (t) => {
  const result = await db.query`select * from generate_series(${1}::int, ${
    2 + 1
  }::int) g`;
  t.equal(result.rowCount, 3, "should return result with rowCount property");
  t.equal(
    result.command,
    "SELECT",
    "should return result with command property"
  );
  t.ok(Array.isArray(result.rows), "should return result with rows property");
});

test("db.rows", async (t) => {
  t.deepEqual(
    await db.rows("select * from generate_series(1, 3) g"),
    [1, 2, 3].map((g) => ({ g })),
    "should return an array of objects"
  );
});

test("db.rows (template string)", async (t) => {
  t.deepEqual(
    await db.rows`select * from generate_series(${1}::int, ${2 + 1}::int) g`,
    [1, 2, 3].map((g) => ({ g })),
    "should return an array of objects"
  );
});

test("db.row", async (t) => {
  t.deepEqual(
    await db.row("select 1 as a"),
    { a: 1 },
    "should return a single object"
  );
});

test("db.row (template string)", async (t) => {
  t.deepEqual(
    await db.row`select ${1}::int as a`,
    { a: 1 },
    "should return a single object"
  );
});

test("db.row (template string with no args)", async (t) => {
  t.deepEqual(
    await db.row`select 1::int as a`,
    { a: 1 },
    "should return a single object"
  );
});

test("db.value", async (t) => {
  t.equal(await db.value("select 1"), 1, "should return a single value");
});

test("db.value (template string)", async (t) => {
  t.equal(await db.value`select ${1}::int`, 1, "should return a single value");
});

test("db.column", async (t) => {
  t.deepEqual(
    await db.column("select * from generate_series(1, 3)"),
    [1, 2, 3],
    "should return an array of the first value in each row"
  );
  t.deepEqual(
    await db.column("select * from generate_series(1, 0)"),
    [],
    "should handle empty results"
  );
});

test("db.column (template string)", async (t) => {
  t.deepEqual(
    await db.column`select * from generate_series(${1}::int, ${3}::int)`,
    [1, 2, 3],
    "should return an array of the first value in each row"
  );
});

test("sql-injection-proof template strings", async (t) => {
  const evil = "SELECT evil\"'";
  t.equal(await db.value`SELECT ${evil}::text`, evil);
});

test("sql-injection-proof template array values", async (t) => {
  const evil = "SELECT evil\"'";
  t.deepEqual(await db.value`SELECT ${[evil]}::text[]`, [evil]);
});

test("escaping", async (t) => {
  t.equal(db.escape("a'a\\"), " E'a''a\\\\'");
  t.equal(db.escape(null), "null");
  t.equal(db.escape(false), "false");
  t.equal(db.escape(true), "true");
  t.equal(db.escapeLiterals(["a", "b"]), "'a', 'b'");
  t.equal(db.escapeIdentifiers(["a", "b"]), '"a", "b"');
});

test("identifier escaping", async (t) => {
  t.equal(db.escapeIdentifier('weird " ?'), '"weird "" ?"');
});

test("identifier template escaping", async (t) => {
  t.equal(
    await db.value`SELECT '${db.identifier('weird " string')}'::text`,
    '"weird "" string"'
  );
});

test("identifiers template escaping", async (t) => {
  const weird = ['a"a\\'];
  t.deepEqual(
    await db.value`SELECT '${db.identifiers(weird)}'::text`,
    '"a""a\\"'
  );
});

test("literal template escaping", async (t) => {
  const weird = "a'a\\";
  t.equal(await db.value`SELECT ${db.literal(weird)}::text`, weird);
});

test("literals template escaping", async (t) => {
  const weird = ["a'a\\"];
  t.deepEqual(
    await db.value`SELECT Array[${db.literals(weird)}]::text[]`,
    weird
  );
});

test("array escaping", async (t) => {
  t.equal(db.escape([1, 2, 3]), "Array[1, 2, 3]");
  t.equal(db.escape(["a'", "b", 'c"']), "Array['a''', 'b', 'c\"']");
  t.equal(db.escape([true, false, null]), "Array[true, false, null]");
});

test("sql template", async (t) => {
  const tpl = db.template`SELECT ${1} AS a, ${[1, 2, 3]} AS ${db.identifier(
    "b"
  )}`;
  t.equal(tpl.__unsafelyGetRawSql(), 'SELECT 1 AS a, Array[1, 2, 3] AS "b"');

  const result = await db.row(tpl);
  t.deepEqual(result, { a: 1, b: [1, 2, 3] });
});

test("nested sql template", async (t) => {
  const subquery = db.template`SELECT ${1} AS ${db.identifier("a")}`;
  const query = db.template`SELECT ${db.identifier("b")}.${db.identifier(
    "a"
  )} FROM (${subquery}) AS ${db.identifier("b")}`;
  t.equal(
    query.__unsafelyGetRawSql(),
    'SELECT "b"."a" FROM (SELECT 1 AS "a") AS "b"'
  );

  const result = await db.row(query);
  t.deepEqual(result, { a: 1 });
});

test("items template escaping", async (t) => {
  const query = db.items([1, "2", db.template`COALESCE(3, 4)`]);
  t.equal(query.__unsafelyGetRawSql(), "1, '2', COALESCE(3, 4)");
});

test("successful transaction", async (t) => {
  await db.query("drop table if exists beep");
  await db.query("create table beep (id integer)");
  await db.query("insert into beep (id) values (1), (2), (3)");

  await db.transaction(async (trx) => {
    t.deepEqual(
      await trx.column("select id from beep order by id -- trx 1"),
      [1, 2, 3],
      "boop is sane"
    );

    await trx.query("delete from beep where id=2");
    await trx.query("insert into beep (id) VALUES (4), (5), (6)");

    t.deepEqual(
      await db.column("select id from beep order by id -- db"),
      [1, 2, 3],
      "changes are invisible outside transaction"
    );

    t.deepEqual(
      await trx.column("select id from beep order by id -- trx 2"),
      [1, 3, 4, 5, 6],
      "changes are visible inside transaction"
    );
  });

  t.deepEqual(
    await db.column("select id from beep order by id -- after"),
    [1, 3, 4, 5, 6],
    "changes are visible after commit"
  );
});

test("bad connection url", async (t) => {
  try {
    await db.configure("postgres://example").query("select 1");
    t.fail("should not be able to connect to postgres://example");
  } catch (err) {
    t.match(
      err.code,
      // We see ENOTFOUND on regular Linux, and EAI_AGAIN under Docker.
      /^ENOTFOUND|EAI_AGAIN$/,
      "incorrect host should throw ENOTFOUND or EAI_AGAIN"
    );
    if (err.code !== "ENOTFOUND" && err.code !== "EAI_AGAIN") throw err;
  }
});

test("config(configFromUrl(...))", async (t) => {
  const config = configFromUrl(
    "postgres://example.com/?keepAlive=false&query_timeout=100"
  );
  t.strictEqual(config.keepAlive, false, "should parse boolean options");
  t.strictEqual(config.query_timeout, 100, "should parse numeric options");
  db.configure(config);
});

test("debug_postgres", async (t) => {
  const DATABASE_URL = process.env.DATABASE_URL;
  assert(DATABASE_URL != null, "must set DATABASE_URL for tests");
  const config = configFromUrl(DATABASE_URL);
  config.debug_postgres = true;
  const db2 = configure(config);
  t.strictEqual(await db2.value`SELECT 1;`, 1, "query should return value");
});

test("no configuration", async () => {
  // Make sure we hit the branches for this during configuration for better
  // coverage.
  process.env.PG_POOL_SIZE = "8";
  process.env.PG_IDLE_TIMEOUT = "100";

  // This happens automatically on startup if `DATABASE_URL` is unset. I'm not
  // sure it's useful for anything, but we need to make sure it doesn't crash.
  db.configure();
});

test("bad query", async (t) => {
  try {
    await db.query("not a real sql query lol");
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    t.equal(
      err.message,
      'SQL Error: syntax error at or near "not"\nnot a real sql query lol',
      "should throw syntax error"
    );
  }
});

test("bad query with params", async (t) => {
  try {
    await db.query(
      "SELECT * FROM imaginary_table WHERE id = $1 AND imaginary = $2",
      [1, true]
    );
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    t.equal(
      err.message,
      'SQL Error: relation "imaginary_table" does not exist\nSELECT * FROM imaginary_table WHERE id = $1 AND imaginary = $2\nQuery parameters:\n  $1: number 1\n  $2: boolean true',
      "should throw syntax error"
    );
  }
});

test("error with notice", async (t) => {
  const sql =
    "DO language plpgsql $$ BEGIN RAISE NOTICE 'notice'; SELECT '1.0'::int; END $$";
  try {
    await db.query(sql);
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    t.match(
      err.message,
      new RegExp(
        `SQL Error: notice: notice\ninvalid input syntax for (type )?integer: "1.0"\n${escapeRegExp(
          sql
        )}`
      )
    );
  }
});

test("error with multiple notices", async (t) => {
  const sql =
    "DO language plpgsql $$ BEGIN RAISE NOTICE 'notice'; RAISE WARNING 'warning'; SELECT '1.0'::int; END $$";
  try {
    await db.query(sql);
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    t.match(
      err.message,
      new RegExp(
        `SQL Error: notice: notice\nnotice: warning\ninvalid input syntax for (type ?)integer: "1.0"\n${escapeRegExp(
          sql
        )}`
      )
    );
  }
});

test("bad sql in transaction", async (t) => {
  db.setErrorHandler((e) => {
    console.log("expected error", e);
  });

  let expectedConnections: number | undefined;
  try {
    await db.transaction(async ({ query }) => {
      await query("not a real sql query lol");
    });
    t.fail("transaction errors should cause the promise to reject");
  } catch (err) {
    expectedConnections = countConnections(await db.pool());
    t.equal(
      err.ABORT_CONNECTION,
      undefined,
      "transaction errors should be recoverable"
    );
  }

  t.equal(
    countConnections(await db.pool()),
    expectedConnections,
    "rollbacks should keep the connection in the pool"
  );
});

test("nested transaction", async (t) => {
  await db.transaction(async (conn) => {
    await conn.query`create temporary table test_nested (id int)`;
    await conn.query`insert into test_nested values (1)`;
    await conn.transaction(async (conn) => {
      t.deepEqual(
        await conn.column<number>`select * from test_nested order by id`,
        [1],
        "should see parent transaction"
      );

      // Triple-nested.
      await conn.query`insert into test_nested values (2)`;
      await conn.transaction(async (conn) => {
        t.deepEqual(
          await conn.column<number>`select * from test_nested order by id`,
          [1, 2],
          "should see all parent transactions"
        );
        await conn.query`insert into test_nested values (3)`;
      });

      t.deepEqual(
        await conn.column<number>`select * from test_nested order by id`,
        [1, 2, 3],
        "should see completed child transactions"
      );

      // Triple-nested for the second time at the same level, and failing.
      try {
        await conn.transaction(async (conn) => {
          await conn.query`insert into test_nested values (4)`;
          t.deepEqual(
            await conn.column<number>`select * from test_nested order by id`,
            [1, 2, 3, 4],
            "should failing child before it fails"
          );
          throw new Error("rolling back");
        });
      } catch (e) {
        t.deepEqual(e.message, "rolling back", "should report rollback error");
      }

      t.deepEqual(
        await conn.column<number>`select * from test_nested order by id`,
        [1, 2, 3],
        "should not see rolled back child transactions"
      );
    });
  });
});

test("failed rollback", async (t) => {
  const connectionsBefore = countConnections(await db.pool());
  try {
    console.log("before transaction");
    await db.transaction(async () => {
      // break the transaction by destroying all connections everywhere
      console.log("destroyConnections");
      await destroyConnections(await db.pool());
      console.log("after destroyConnections");
      throw new Error("initial transaction error");
    });
    t.fail("transaction errors should cause the promise to reject");
  } catch (err) {
    t.ok(
      /Error: Failed to execute rollback after error\n/.test(err),
      "broken rollback should explain what's up"
    );
    t.ok(
      /Error: initial transaction error\n {4}at /.test(err),
      "broken rollback should contain initial error stack"
    );
    t.ok(
      /SQL Error: Client was closed and is not queryable/.test(err),
      "broken rollback should contain the rollback error stack"
    );
    t.equal(
      err.ABORT_CONNECTION,
      true,
      "transaction errors should propagate up"
    );
  }

  t.equal(
    countConnections(await db.pool()),
    connectionsBefore - 1,
    "failed transaction rollbacks should remove the client from the pool"
  );
});

test("escape and template functions are exported", async (t) => {
  const fns = [
    escapeIdentifier,
    escapeIdentifiers,
    escapeLiteral,
    escapeLiterals,
    template,
    identifier,
    identifiers,
    items,
    literal,
    literals,
  ];
  for (const fn of fns) {
    // The `db.` prefixed versions are for backwards compatibility.
    t.deepEqual(
      fn,
      (db as Record<string, unknown>)[fn.name],
      `${fn.name} and db.${fn.name} should be the same function`
    );
  }
});

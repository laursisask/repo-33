import pg, { Pool } from "pg";
import test from "blue-tape";
import db, { sql, configure } from "../src/index";

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

test("db.connection", async (t) => {
  await db.connection(async (c) => {
    await c.query`SET statement_timeout=123456789`;
    await db.query`RESET statement_timeout`;
    t.equal(
      await c.value`SHOW statement_timeout`,
      "123456789ms",
      "should use the same connection"
    );
  });
});

test("db.query", async (t) => {
  const q = sql`select * from generate_series(1, 3) g`;
  const result = await db.query(q);
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
  const q = sql`select * from generate_series(1, 3) g`;
  t.deepEqual(
    await db.rows(q),
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
  const q = sql`select 1 as a`;
  t.deepEqual(await db.row(q), { a: 1 }, "should return a single object");
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
  const q = sql`select 1`;
  t.equal(await db.value(q), 1, "should return a single value");
});

test("db.value (template string)", async (t) => {
  t.equal(await db.value`select ${1}::int`, 1, "should return a single value");
});

test("db.column", async (t) => {
  const q1 = sql`select * from generate_series(1, 3)`;
  t.deepEqual(
    await db.column(q1),
    [1, 2, 3],
    "should return an array of the first value in each row"
  );
  const q2 = sql`select * from generate_series(1, 0)`;
  t.deepEqual(await db.column(q2), [], "should handle empty results");
});

test("db.column (template string)", async (t) => {
  t.deepEqual(
    await db.column`select * from generate_series(${1}::int, ${3}::int)`,
    [1, 2, 3],
    "should return an array of the first value in each row"
  );
});

test("successful transaction", async (t) => {
  await db.query`drop table if exists beep`;
  await db.query`create table beep (id integer)`;
  await db.query`insert into beep (id) values (1), (2), (3)`;

  await db.transaction(async (trx) => {
    t.deepEqual(
      await trx.column`select id from beep order by id -- trx 1`,
      [1, 2, 3],
      "boop is sane"
    );

    await trx.query`delete from beep where id=2`;
    await trx.query`insert into beep (id) VALUES (4), (5), (6)`;

    t.deepEqual(
      await db.column`select id from beep order by id -- db`,
      [1, 2, 3],
      "changes are invisible outside transaction"
    );

    t.deepEqual(
      await trx.column`select id from beep order by id -- trx 2`,
      [1, 3, 4, 5, 6],
      "changes are visible inside transaction"
    );
  });

  t.deepEqual(
    await db.column`select id from beep order by id -- after`,
    [1, 3, 4, 5, 6],
    "changes are visible after commit"
  );
});

test("configuration object", async (t) => {
  const conn = configure({
    host: "db",
    port: 5432,
    user: "postgres",
    database: "postgres",
  });

  const value = await conn.value`select 1`;

  t.equal(value, 1);
});

test("bad connection url", async (t) => {
  try {
    await configure("postgres://example").query`select 1`;
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

test("bad query", async (t) => {
  try {
    await db.query`not a real sql query lol`;
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
    await db.query`SELECT * FROM imaginary_table WHERE id = ${1} AND imaginary = ${true}`;
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
  const q = sql`DO language plpgsql $$ BEGIN RAISE NOTICE 'notice'; SELECT '1.0'::int; END $$`;

  try {
    await db.query(q);
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    console.log(err.message);
    t.match(
      err.message,
      new RegExp(
        `SQL Error: notice: notice\ninvalid input syntax for (type )?integer: "1.0"\n${escapeRegExp(
          q.text
        )}`
      )
    );
  }
});

test("error with multiple notices", async (t) => {
  const q = sql`DO language plpgsql $$ BEGIN RAISE NOTICE 'notice'; RAISE WARNING 'warning'; SELECT '1.0'::int; END $$`;

  try {
    await db.query(q);
    t.fail("should not be able to execute an invalid query");
  } catch (err) {
    t.match(
      err.message,
      new RegExp(
        `SQL Error: notice: notice\nnotice: warning\ninvalid input syntax for (type ?)integer: "1.0"\n${escapeRegExp(
          q.text
        )}`
      )
    );
  }
});

test("bad sql in transaction", async (t) => {
  // db.setErrorHandler((e) => {
  //   console.log("expected error", e);
  // });

  let expectedConnections: number | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.query`not a real sql query lol`;
    });
    t.fail("transaction errors should cause the promise to reject");
  } catch (err) {
    expectedConnections = countConnections(db.pool);
    t.equal(
      err.ABORT_CONNECTION,
      undefined,
      "transaction errors should be recoverable"
    );
  }

  t.equal(
    countConnections(db.pool),
    expectedConnections,
    "rollbacks should keep the connection in the pool"
  );
});

test("basic query stream", async (t) => {
  const stream = await db.stream`select * from generate_series(1, 3) g`;

  const values = [1, 2, 3];

  for await (const it of stream) {
    t.deepEqual(it, { g: values.shift() });
  }
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
  const connectionsBefore = countConnections(db.pool);
  try {
    console.log("before transaction");
    await db.transaction(async () => {
      // break the transaction by destroying all connections everywhere
      console.log("destroyConnections");
      await destroyConnections(db.pool);
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
    countConnections(await db.pool),
    connectionsBefore - 1,
    "failed transaction rollbacks should remove the client from the pool"
  );
});

test("end shuts down the pool", async (t) => {
  await db.end();

  try {
    await db.value`select 1`; // shouldn't be possible because pool is ended
  } catch (e) {
    t.equal(
      e.message,
      "Cannot use a pool after calling end on the pool",
      "Can't use pool after closing"
    );
  }
});

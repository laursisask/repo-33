# simple-postgres

A minimalist layer for interacting with Postgres databases using Javascript
tagged literals (provided via [selectstar]), and returning Javascript values
quickly from idiomatic queries.

## Getting started

```console
npm install @fdy/simple-postgres
```

```ts
import db from "simple-postgres";

// Unsafe user input:
const accountName = "ACME'; DELETE FROM accounts; --";

// But this is totally safe:
const account = await db.row`
  SELECT *
  FROM accounts
  WHERE name = ${accountName}
`;

console.log(account.name); // => 'ACME\'; DELETE FROM accounts; --'
```

## Writing queries

Simple Postgres uses [selectstar] to handle query generation. Queries can be
constructed as a tagged literal, or generated with the `sql` function:

```ts
import db, { sql } from 'simple-postgres'; // sql is a passthrough from selectstar

async function findStarshipByName(name: string): Promise<Starship> {
  const starships = await db.query<Starship>`
    SELECT id, name, mass
    FROM starships
    WHERE name ILIKE ${'%' + name + '%'}
  `;

  return starships.rows;
}

// alternatively:
async function findPilotsByName(name: string): Promise<Pilot> {
  const query = sql`SELECT id, name FROM pilots WHERE name ILIKE ${'%' + name + '%'}`

  // Use the pre-defined query instead of a tagged literal:
  const pilots = await db.query<Pilot>(query);

  return pilots.rows;
}
```

## Usage

Simple Postgres offers a collection of query shorthands that make it easier
to handle the response value from Postgres:

* `db.query` is a passthrough to node-pg's query method
* `db.rows` returns only the rows from a query
* `db.row` returns only the first row from a query
* `db.column` returns only the first column from a query
* `db.value` returns only the first column from the first row of the query

There are also some tools to make transactions and streams easier to handle:

### `db.connection` runs many queries with the same connection

If your database has a lot of contention for connections, it can sometimes be
useful to hold a single connection for a while to service a single request or
set of queries. Usually this isn't necessary, though transactions are
implicitly carried out on the same connection.

```ts
import db from '@fdy/simple-postgres';

const userAndAccountInfo = await db.connection(async conn => {
  const user = await conn.row`SELECT id, name, account_id FROM users WHERE id = ${userId}`;
  const account = await conn.row`SELECT id, name FROM accounts WHERE id = ${user.account_id}`;

  return { user, account };
});
```

### `db.transaction` starts a transaction (or nested savepoint)

Starts a [database transaction] and runs the contained queries within that
transaction. If the block of work throws an error for any reason, the
transaction is rolled back. Nested transactions use [savepoints] to allow
partial rollbacks.

```ts
const newUser = await db.transaction(async tx => {
  const userId = await tx.value`
    INSERT INTO users (id, name)
    VALUES (uuid_generate_v4(), ${userName})
    RETURNING id
  `;
  
  const accountId = await tx.value`
    INSERT INTO accounts (id, name, owner_id)
    VALUES (uuid_generate_v4(), ${accountName}, ${userId})
  `;

  await db.query`UPDATE users SET account_id = ${accountId}`;
  
  return db.row`SELECT * FROM users WHERE id = ${userId}`;
});
```

### `db.stream` starts a query stream (using `pg-query-stream`)

Performing operations across very large datasets can exceed the amount of
memory available to Node. It can also put strain on the database that might be
avoided with an incremental loading approach. `db.stream` uses the optional
`pg-query-stream` dependency to create a Node [`ReadableStream`] to pull
records out of the database.

This is very useful for ETL jobs or complex calculations that require very
large datasets, or operating in memory-constrained environments. 

```ts
import { format } from '@fast-csv/format';

const csvStream = format({ headers: true });
const users = await db.stream<User>`SELECT * FROM users`;

// Pipe users from the database to stdout, but as csv:
users.pipe(csvStream).pipe(process.stdout).on('end', () => process.exit());
```

Remember: To use `db.stream` you must install the optional dependency
`pg-query-stream`.

### Rationale

Simple Postgres attempts to be a low-abstraction interface layer with your
Postgres database. While high-level abstractions over SQL databases have their
places, very often they require making large sacrifices of simplicity to gain
some ease-of-use.

Simple Postgres is, in the common case, completely configuration-free. Just
import the `db` interface and start writing queries. This allows small projects
to spend more time writing self-evident queries than in complex database
configuration required by other interface libraries, or ORMs.

Further, many libraries offer an abstraction over the actual SQL language,
which means that some advanced features are either difficult to access, or are
completely disallowed. Writing queries in Simple Postgres is the same as 
evaluating SQL queries in the query console: everything that the database can
execute can be represented in this library.

[selectstar]: https://github.com/faradayio/selectstar
[database transaction]: (https://www.postgresql.org/docs/current/static/tutorial-transactions.html)
[savepoints]: (https://www.postgresql.org/docs/8.1/sql-savepoint.html)
[`ReadableStream`]: (https://nodejs.org/api/stream.html#stream_readable_streams)
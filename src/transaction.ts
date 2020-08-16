import { RawSql, identifier, template as sql } from "./templating";

/** Abstract interface to a transaction. */
export abstract class Transaction {
  /** SQL to begin this transaction. */
  abstract beginStatement(): RawSql;

  /** SQL to end this transaction. */
  abstract commitStatement(): RawSql;

  /** SQL to roll back this transaction. */
  abstract rollbackStatement(): RawSql;

  /** Create a nested transaction. */
  abstract newChildTransaction(): Transaction;
}

/** A top-level transaction. */
export class RealTransaction extends Transaction {
  beginStatement(): RawSql {
    return sql`begin`;
  }

  commitStatement(): RawSql {
    return sql`commit`;
  }

  rollbackStatement(): RawSql {
    return sql`rollback`;
  }

  newChildTransaction(): Transaction {
    return new Savepoint(1);
  }
}

/**
 * A nested transaction using "savepoints".
 *
 * See https://www.postgresql.org/docs/11/sql-savepoint.html for an explanation
 * of how this works in SQL, since very few databases allow you to nest "begin"
 * statements.
 */
export class Savepoint extends Transaction {
  /** A unique ID number for this savepoint within the current transaction. */
  private id: number;

  /** A unique name for this savepoint within the current transaction. */
  private savepointName: RawSql;

  /**
   * Create a new savepoint with the specified ID, which must be unique within
   * the current transaction (at least until we "commit" or roll back the
   * savepoint, after which we can re-use it).
   */
  constructor(id: number) {
    super();
    this.id = id;
    this.savepointName = identifier(`save_${id}`);
  }

  beginStatement(): RawSql {
    return sql`savepoint ${this.savepointName}`;
  }

  commitStatement(): RawSql {
    return sql`release savepoint ${this.savepointName}`;
  }

  rollbackStatement(): RawSql {
    return sql`rollback to savepoint ${this.savepointName}`;
  }

  newChildTransaction(): Transaction {
    return new Savepoint(this.id + 1);
  }
}

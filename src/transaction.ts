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
  /** The number to use for the next savepoint. */
  private nextSavepointNumber: number;

  constructor() {
    super();
    this.nextSavepointNumber = 0;
  }

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
    return new Savepoint(this);
  }

  /**
   * Returns an SQL identifier for a savepoint which is unique in this
   * transaction.
   */
  getUniqueSavepointId(): RawSql {
    const ident = identifier(`save_${this.nextSavepointNumber}`);
    this.nextSavepointNumber += 1;
    return ident;
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
  /** The root transaction, for generating unique savepoint names. */
  private rootTransaction: RealTransaction;

  /** A unique identifier for this savepoint within the current transaction. */
  private id: RawSql;

  /**
   * Create a new savepoint.
   *
   * @param rootTransaction The root transaction, which generates unique savepoint names.
   */
  constructor(rootTransaction: RealTransaction) {
    super();
    this.rootTransaction = rootTransaction;
    this.id = rootTransaction.getUniqueSavepointId();
  }

  beginStatement(): RawSql {
    return sql`savepoint ${this.id}`;
  }

  commitStatement(): RawSql {
    return sql`release savepoint ${this.id}`;
  }

  rollbackStatement(): RawSql {
    return sql`rollback to savepoint ${this.id}`;
  }

  newChildTransaction(): Transaction {
    return new Savepoint(this.rootTransaction);
  }
}

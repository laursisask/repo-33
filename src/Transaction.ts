import { Template, template, identifier } from "selectstar";

/** Abstract interface to a transaction. */
export abstract class Transaction {
  /** SQL to begin this transaction. */
  abstract beginStatement(): Template;

  /** SQL to end this transaction. */
  abstract commitStatement(): Template;

  /** SQL to roll back this transaction. */
  abstract rollbackStatement(): Template;

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

  beginStatement(): Template {
    return template`begin`;
  }

  commitStatement(): Template {
    return template`commit`;
  }

  rollbackStatement(): Template {
    return template`rollback`;
  }

  newChildTransaction(): Transaction {
    return new Savepoint(this);
  }

  /**
   * Returns an SQL identifier for a savepoint which is unique in this
   * transaction.
   */
  getUniqueSavepointId(): Template {
    const ident = identifier(`save_${this.nextSavepointNumber}`);
    this.nextSavepointNumber += 1;
    return template`${ident}`;
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
  private id: Template;

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

  beginStatement(): Template {
    return template`savepoint ${this.id}`;
  }

  commitStatement(): Template {
    return template`release savepoint ${this.id}`;
  }

  rollbackStatement(): Template {
    return template`rollback to savepoint ${this.id}`;
  }

  newChildTransaction(): Transaction {
    return new Savepoint(this.rootTransaction);
  }
}

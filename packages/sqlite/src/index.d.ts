import type { NativeCallback } from "@lucent-lang/core/types";

/**
 * Borrowed transaction handle. Valid only inside `transaction(body)`; do not
 * retain, return, or use after the body completes. Nested transactions are
 * unsupported in this scaffold. Methods are synchronous because borrowed
 * external references cannot appear in async native calls.
 */
export declare class SQLiteTransaction {
  execute(sql: string, params: string[]): void;
  /** Returns matching row count for the CI in-memory map. */
  query(sql: string, params: string[]): number;
}

/**
 * Owned SQLite database. Open via constructor path; close on teardown.
 * Typed row records / async I/O land with a real engine; this scaffold uses
 * sync execute/query against an in-memory map.
 */
export declare class SQLiteDatabase {
  constructor(path: string);
  readonly closed: boolean;
  execute(sql: string, params: string[]): void;
  query(sql: string, params: string[]): number;
  /**
   * Run `body` with a borrowed `SQLiteTransaction` that cannot escape the
   * callback. Commit on success; rollback on body failure (CI map stub).
   */
  transaction(body: NativeCallback<(tx: SQLiteTransaction) => void>): void;
  close(): Promise<void>;
  dispose(): void;
}

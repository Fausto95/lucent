import type { LibraryModule, NativeBinding } from "@lucent-lang/compiler";
import { nativeSymbolId } from "@lucent-lang/compiler";
import { nativeSource } from "./native-sources.generated.ts";

const symbol = (owner: string, name: string, abi: string) => nativeSymbolId("Sqlite", owner, name, abi);

/**
 * Transaction body receives a borrowed `SQLiteTransaction` that must not escape
 * the callback. Native closures are synchronous; execute/query on the borrowed
 * tx are therefore sync in this scaffold (CI in-memory map).
 */
const transactionBodyContract = {
  ownership: "retained" as const,
  callback: {
    retention: "call" as const,
    executor: "caller" as const,
    errors: "propagate" as const,
  },
};

const operations = {
  SQLiteDatabase__create: [
    "return try LucentSQLiteDatabase.open(path: path)",
    "return LucentSQLiteDatabase.open(path)",
  ],
  SQLiteDatabase__get_closed: ["return lucentSelf.closed", "return lucentSelf.closed"],
  SQLiteDatabase__method_execute: [
    "try lucentSelf.execute(sql: sql, params: params)",
    "lucentSelf.execute(sql, params)",
  ],
  SQLiteDatabase__method_query: [
    "return try lucentSelf.query(sql: sql, params: params)",
    "return lucentSelf.query(sql, params)",
  ],
  SQLiteDatabase__method_transaction: ["try lucentSelf.transaction(body: body)", "lucentSelf.transaction(body)"],
  SQLiteDatabase__method_close: ["await lucentSelf.close()", "lucentSelf.close()"],
  SQLiteTransaction__method_execute: [
    "try lucentSelf.execute(sql: sql, params: params)",
    "lucentSelf.execute(sql, params)",
  ],
  SQLiteTransaction__method_query: [
    "return try lucentSelf.query(sql: sql, params: params)",
    "return lucentSelf.query(sql, params)",
  ],
} as const;

const ownedCreates = new Set(["SQLiteDatabase__create"]);

const bindings: Record<string, NativeBinding> = Object.fromEntries(
  Object.entries(operations).map(([name, [swift, kotlin]]) => [
    name,
    {
      contract: {
        symbolId: symbol(name.split("__")[0]!, name, "v1"),
        ...(ownedCreates.has(name) ? { result: "owned" as const } : {}),
        ...(name === "SQLiteDatabase__method_transaction" ? { parameters: { body: transactionBodyContract } } : {}),
        ...(name === "SQLiteDatabase__method_close" ? { cancellation: "cooperative" as const } : {}),
      },
      ...(name.startsWith("SQLiteTransaction__") ? { nativeOnly: true } : {}),
      swift: [swift],
      kotlin: [kotlin],
    },
  ]),
);

/** SQLite acceptance package — in-memory map stubs for CI. */
export const SQLITE_LIBRARY: LibraryModule = {
  schemaVersion: 1,
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type SQLiteDatabase = { closed: boolean };
export type SQLiteTransaction = {};
export declare function SQLiteDatabase__create(path: string): SQLiteDatabase;
export declare function SQLiteDatabase__get_closed(lucentSelf: SQLiteDatabase): boolean;
export declare function SQLiteDatabase__method_execute(lucentSelf: SQLiteDatabase, sql: string, params: string[]): void;
export declare function SQLiteDatabase__method_query(lucentSelf: SQLiteDatabase, sql: string, params: string[]): number;
export declare function SQLiteDatabase__method_transaction(lucentSelf: SQLiteDatabase, body: NativeCallback<(tx: SQLiteTransaction) => void>): void;
export declare function SQLiteDatabase__method_close(lucentSelf: SQLiteDatabase): Promise<void>;
export declare function SQLiteTransaction__method_execute(lucentSelf: SQLiteTransaction, sql: string, params: string[]): void;
export declare function SQLiteTransaction__method_query(lucentSelf: SQLiteTransaction, sql: string, params: string[]): number;`,
  references: {
    SQLiteDatabase: {
      nativeOnly: true,
      swift: "LucentSQLiteDatabase",
      kotlin: "LucentSQLiteDatabase",
      contract: { ownership: "owned", executor: "caller", transferable: true, close: "close" },
    },
    SQLiteTransaction: {
      nativeOnly: true,
      swift: "LucentSQLiteTransaction",
      kotlin: "LucentSQLiteTransaction",
      /** Borrowed for the duration of the transaction body; must not escape. */
      contract: { ownership: "external", executor: "caller" },
    },
  },
  bindings,
  native: {
    capabilities: ["sqlite"],
    swift: { "Sqlite.swift": nativeSource("Sqlite.swift") },
    kotlin: { "Sqlite.kt": nativeSource("Sqlite.kt") },
  },
};

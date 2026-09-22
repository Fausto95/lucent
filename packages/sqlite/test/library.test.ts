import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "@lucent-lang/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SQLITE_LIBRARY } from "../src/library.ts";

const libraries = { "@lucent-lang/sqlite": SQLITE_LIBRARY };
const here = dirname(fileURLToPath(import.meta.url));
const lucent = (name: string) => readFileSync(join(here, "..", "lucent", name), "utf8");

test("SQLITE_LIBRARY passes validation with borrowed transaction", () => {
  expect(validateLibrary(SQLITE_LIBRARY)).toEqual([]);
  expect(SQLITE_LIBRARY.references!.SQLiteTransaction!.contract).toEqual({
    ownership: "external",
    executor: "caller",
  });
  const tx = SQLITE_LIBRARY.bindings!.SQLiteDatabase__method_transaction!;
  expect(tx.contract!.parameters!.body!.callback).toEqual({
    retention: "call",
    executor: "caller",
    errors: "propagate",
  });
});

test("compiles open / transaction / close", () => {
  const result = compile(lucent("transaction.lucent.ts"), {
    fileName: "transaction.lucent.ts",
    libraries,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual(
    expect.arrayContaining(["Sqlite.swift", "Resource.swift"]),
  );
});

test("compiles execute and query with typed params", () => {
  const result = compile(
    `import {SQLiteDatabase} from '@lucent-lang/sqlite';
@NativeOnly export function count(db:SQLiteDatabase):number{
  db.execute("INSERT INTO t(id) VALUES (?)",["x"]);
  return db.query("SELECT id FROM t WHERE id=?",["x"]);
}`,
    { fileName: "query.lucent.ts", libraries },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects transaction borrow escape", () => {
  const result = compile(
    `import {SQLiteDatabase,SQLiteTransaction} from '@lucent-lang/sqlite';
export function leak(db:SQLiteDatabase):SQLiteTransaction{
  let escaped:SQLiteTransaction=null as unknown as SQLiteTransaction;
  db.transaction((tx):void=>{escaped=tx;});
  return escaped;
}`,
    { fileName: "tx-escape.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

test("rejects use after close", () => {
  const result = compile(
    `import {SQLiteDatabase} from '@lucent-lang/sqlite';
export async function bad(db:SQLiteDatabase):Promise<number>{
  await db.close();
  return db.query("SELECT 1",[]);
}`,
    { fileName: "use-after-close.lucent.ts", libraries },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("closed"))).toBe(true);
});

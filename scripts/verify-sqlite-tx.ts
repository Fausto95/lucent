/**
 * Prove SQLite in-memory transaction rollback on throw (codegen harness).
 * Insert, fail inside transaction, assert prior row count restored.
 */
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { SQLITE_LIBRARY } from "../packages/sqlite/src/library.ts";
import {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
} from "./lib/index.ts";

const result = compile(
  `import {SQLiteDatabase,SQLiteTransaction} from '@lucent-lang/sqlite';
@NativeOnly export function openDb():SQLiteDatabase{return new SQLiteDatabase(":memory:");}
@NativeOnly export function execute(db:SQLiteDatabase,sql:string,params:string[]):void{db.execute(sql,params);}
@NativeOnly export function query(db:SQLiteDatabase,sql:string,params:string[]):number{return db.query(sql,params);}
@NativeOnly export function runOk(db:SQLiteDatabase):void{
  db.transaction((tx:SQLiteTransaction):void=>{tx.execute("INSERT INTO t(id) VALUES (?)",["ok"]);});
}
@NativeOnly export function runFail(db:SQLiteDatabase):void{
  db.transaction((tx:SQLiteTransaction):void=>{
    tx.execute("INSERT INTO t(id) VALUES (?)",["rollback-me"]);
    tx.execute("THROW",[]);
  });
}
@NativeOnly export async function closeDb(db:SQLiteDatabase):Promise<void>{await db.close();}`,
  {
    fileName: "sqlite-tx.lucent.ts",
    libraries: { "@lucent-lang/sqlite": SQLITE_LIBRARY },
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-sqlite-tx-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let before = LucentSqliteCounts.liveDatabases",
      "let db = try openDb()",
      'try execute(db: db, sql: "INSERT INTO t(id) VALUES (?)", params: ["seed"])',
      'let seedCount = try query(db: db, sql: "SELECT", params: ["seed"])',
      "precondition(seedCount == 1)",
      "try runOk(db: db)",
      'let okCount = try query(db: db, sql: "SELECT", params: ["ok"])',
      "precondition(okCount == 1)",
      "do {",
      "  try runFail(db: db)",
      '  preconditionFailure("expected rollback throw")',
      "} catch {",
      "  // rolled back",
      "}",
      'let rolled = try query(db: db, sql: "SELECT", params: ["rollback-me"])',
      "precondition(rolled == 0)",
      'let seedAfter = try query(db: db, sql: "SELECT", params: ["seed"])',
      "precondition(seedAfter == 1)",
      'let okAfter = try query(db: db, sql: "SELECT", params: ["ok"])',
      "precondition(okAfter == 1)",
      "try await closeDb(db: db)",
      "precondition(LucentSqliteCounts.liveDatabases == before)",
      'print("swift: sqlite transaction rollback passed")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val before = LucentSqliteCounts.liveDatabases",
    "val db = openDb()",
    'execute(db, "INSERT INTO t(id) VALUES (?)", mutableListOf("seed"))',
    'check(query(db, "SELECT", mutableListOf("seed")) == 1.0)',
    "runOk(db)",
    'check(query(db, "SELECT", mutableListOf("ok")) == 1.0)',
    "var threw = false",
    block("try {", ["runFail(db)"], "} catch (_: Throwable) { threw = true }"),
    "check(threw)",
    'check(query(db, "SELECT", mutableListOf("rollback-me")) == 0.0)',
    'check(query(db, "SELECT", mutableListOf("seed")) == 1.0)',
    'check(query(db, "SELECT", mutableListOf("ok")) == 1.0)',
    "var closed = false",
    "val closing: suspend () -> Unit = { closeDb(db) }",
    block(
      "closing.startCoroutine(object: Continuation<Unit> {",
      [
        "override val context = kotlin.coroutines.EmptyCoroutineContext",
        "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closed = true }",
      ],
      "})",
    ),
    "while (!closed) Thread.yield()",
    "check(LucentSqliteCounts.liveDatabases == before)",
    'println("kotlin: sqlite transaction rollback passed")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);

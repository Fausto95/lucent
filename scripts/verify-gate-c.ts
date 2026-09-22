/**
 * Gate C acceptance: compile @lucent-lang/{bluetooth,sqlite,location,background,streaming}
 * and exercise CI native stubs on Swift and Kotlin toolchains.
 *
 * Smoke + one close-during-operation barrier race per package. Harnesses are
 * Doc-built via @lucent-lang/codegen (no TS string-concat of braces/indent).
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { block, sections, type Doc } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import type { LibraryModule } from "../packages/compiler/src/index.ts";
import { BLUETOOTH_LIBRARY } from "../packages/bluetooth/src/library.ts";
import { SQLITE_LIBRARY } from "../packages/sqlite/src/library.ts";
import { LOCATION_LIBRARY } from "../packages/location/src/library.ts";
import { BACKGROUND_LIBRARY } from "../packages/background/src/library.ts";
import { STREAMING_LIBRARY } from "../packages/streaming/src/library.ts";
import { renderKotlinVerifyProgram, renderSwiftVerifyProgram } from "./lib/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "lucent-gate-c-"));

/** Prefer an installed JDK when `/usr/bin/java` is only a macOS stub. */
function resolveJava(): string {
  if (process.env.JAVA_HOME) {
    const candidate = join(process.env.JAVA_HOME, "bin", "java");
    if (existsSync(candidate)) return candidate;
  }
  for (const home of [
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home",
    "/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  ]) {
    const candidate = join(home, "bin", "java");
    if (existsSync(candidate)) return candidate;
  }
  return "java";
}
const javaBin = resolveJava();

type PackageSmoke = {
  name: string;
  libraries: Record<string, LibraryModule>;
  source: string;
  fileName: string;
  sources?: Record<string, string>;
  swiftSmoke: Doc[];
  kotlinSmoke: Doc[];
  swiftRace: Doc[];
  kotlinRace: Doc[];
};

const bluetoothLucent = readFileSync(join(root, "packages/bluetooth/lucent/scan-connect.lucent.ts"), "utf8");
const sqliteLucent = readFileSync(join(root, "packages/sqlite/lucent/transaction.lucent.ts"), "utf8");
const locationLucent = readFileSync(join(root, "packages/location/lucent/provider-updates.lucent.ts"), "utf8");
const backgroundLucent = readFileSync(join(root, "packages/background/lucent/schedule-job.lucent.ts"), "utf8");
const streamingLucent = readFileSync(join(root, "packages/streaming/lucent/pipeline.lucent.ts"), "utf8");

const packages: PackageSmoke[] = [
  {
    name: "bluetooth",
    libraries: { "@lucent-lang/bluetooth": BLUETOOTH_LIBRARY },
    fileName: "bluetooth-package.lucent.ts",
    sources: { "scan-connect.lucent.ts": bluetoothLucent },
    source: `import {BluetoothScanner,BluetoothConnection} from '@lucent-lang/bluetooth';
import {runScanConnect} from './scan-connect.lucent';
@NativeOnly export function makeScanner():BluetoothScanner{return new BluetoothScanner();}
@NativeOnly export function start(scanner:BluetoothScanner):void{scanner.start();}
@NativeOnly export async function connect(scanner:BluetoothScanner):Promise<BluetoothConnection>{return await scanner.connect("fake-1");}
@NativeOnly export async function closeScanner(scanner:BluetoothScanner):Promise<void>{await scanner.close();}
@NativeOnly export async function closeConnection(connection:BluetoothConnection):Promise<void>{await connection.close();}
export async function lifecycle():Promise<void>{await runScanConnect();}`,
    swiftSmoke: [
      "let before = LucentBluetoothCounts.liveScanners",
      "let scanner = try makeScanner()",
      "precondition(LucentBluetoothCounts.liveScanners == before + 1)",
      "try start(scanner: scanner)",
      "let connection = try await connect(scanner: scanner)",
      "precondition(LucentBluetoothCounts.liveConnections == 1)",
      "try await closeConnection(connection: connection)",
      "try await closeScanner(scanner: scanner)",
      "precondition(LucentBluetoothCounts.liveScanners == before)",
      "precondition(LucentBluetoothCounts.liveConnections == 0)",
      "try await lifecycle()",
      'print("swift: bluetooth scan/connect/close passed")',
    ],
    kotlinSmoke: [
      "val before = LucentBluetoothCounts.liveScanners",
      "val scanner = makeScanner()",
      "check(LucentBluetoothCounts.liveScanners == before + 1.0)",
      "start(scanner)",
      "var connectionDone = false",
      "var connection: LucentBluetoothConnection? = null",
      "val connecting: suspend () -> Unit = { connection = connect(scanner) }",
      block(
        "connecting.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); connectionDone = true }",
        ],
        "})",
      ),
      "while (!connectionDone) Thread.yield()",
      "check(LucentBluetoothCounts.liveConnections == 1.0)",
      "var closedConn = false",
      "val closingConn: suspend () -> Unit = { closeConnection(connection!!) }",
      block(
        "closingConn.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closedConn = true }",
        ],
        "})",
      ),
      "while (!closedConn) Thread.yield()",
      "var closedScan = false",
      "val closingScan: suspend () -> Unit = { closeScanner(scanner) }",
      block(
        "closingScan.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closedScan = true }",
        ],
        "})",
      ),
      "while (!closedScan) Thread.yield()",
      "check(LucentBluetoothCounts.liveScanners == before)",
      "check(LucentBluetoothCounts.liveConnections == 0.0)",
      "var lifecycleDone = false",
      "val owned: suspend () -> Unit = { lifecycle() }",
      block(
        "owned.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); lifecycleDone = true }",
        ],
        "})",
      ),
      "while (!lifecycleDone) Thread.yield()",
      'println("kotlin: bluetooth scan/connect/close passed")',
    ],
    swiftRace: [
      "let raceScanner = try makeScanner()",
      "try start(scanner: raceScanner)",
      "let connectTask = Task { try? await connect(scanner: raceScanner) }",
      "await Task.yield()",
      "try await closeScanner(scanner: raceScanner)",
      "_ = await connectTask.value",
      'print("swift: bluetooth close-during-connect race passed")',
    ],
    kotlinRace: [
      "val raceScanner = makeScanner()",
      "start(raceScanner)",
      "var raceConnectDone = false",
      "val raceConnecting: suspend () -> Unit = { try { connect(raceScanner) } catch (_: Throwable) {} }",
      block(
        "raceConnecting.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { raceConnectDone = true }",
        ],
        "})",
      ),
      "Thread.yield()",
      "var raceClosed = false",
      "val raceClosing: suspend () -> Unit = { closeScanner(raceScanner) }",
      block(
        "raceClosing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); raceClosed = true }",
        ],
        "})",
      ),
      "while (!raceConnectDone || !raceClosed) Thread.yield()",
      'println("kotlin: bluetooth close-during-connect race passed")',
    ],
  },
  {
    name: "sqlite",
    libraries: { "@lucent-lang/sqlite": SQLITE_LIBRARY },
    fileName: "sqlite-package.lucent.ts",
    sources: { "transaction.lucent.ts": sqliteLucent },
    source: `import {SQLiteDatabase} from '@lucent-lang/sqlite';
import {runTransaction} from './transaction.lucent';
@NativeOnly export function openDb():SQLiteDatabase{return new SQLiteDatabase(":memory:");}
@NativeOnly export async function closeDb(db:SQLiteDatabase):Promise<void>{await db.close();}
export async function lifecycle():Promise<void>{await runTransaction();}`,
    swiftSmoke: [
      "let before = LucentSqliteCounts.liveDatabases",
      "let db = try openDb()",
      "precondition(LucentSqliteCounts.liveDatabases == before + 1)",
      "try await closeDb(db: db)",
      "precondition(LucentSqliteCounts.liveDatabases == before)",
      "try await lifecycle()",
      'print("swift: sqlite open/transaction/close passed")',
    ],
    kotlinSmoke: [
      "val before = LucentSqliteCounts.liveDatabases",
      "val db = openDb()",
      "check(LucentSqliteCounts.liveDatabases == before + 1.0)",
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
      "var lifecycleDone = false",
      "val owned: suspend () -> Unit = { lifecycle() }",
      block(
        "owned.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); lifecycleDone = true }",
        ],
        "})",
      ),
      "while (!lifecycleDone) Thread.yield()",
      'println("kotlin: sqlite open/transaction/close passed")',
    ],
    swiftRace: [
      "let raceDb = try openDb()",
      "let closeTask = Task { try await closeDb(db: raceDb) }",
      "await Task.yield()",
      "try await closeTask.value",
      "precondition(raceDb.closed)",
      'print("swift: sqlite close-during-hold race passed")',
    ],
    kotlinRace: [
      "val raceDb = openDb()",
      "var raceClosed = false",
      "val raceClosing: suspend () -> Unit = { closeDb(raceDb) }",
      block(
        "raceClosing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); raceClosed = true }",
        ],
        "})",
      ),
      "while (!raceClosed) Thread.yield()",
      "check(raceDb.closed)",
      'println("kotlin: sqlite close-during-hold race passed")',
    ],
  },
  {
    name: "location",
    libraries: { "@lucent-lang/location": LOCATION_LIBRARY },
    fileName: "location-package.lucent.ts",
    sources: { "provider-updates.lucent.ts": locationLucent },
    source: `import {LocationProvider,LocationPermission,requestPermission} from '@lucent-lang/location';
import {runProviderUpdates} from './provider-updates.lucent';
@NativeOnly export function makeProvider():LocationProvider{return new LocationProvider();}
@NativeOnly export function permission():LocationPermission{return requestPermission();}
@NativeOnly export function attach(provider:LocationProvider):number{return provider.updates((p):number=>p.latitude);}
@NativeOnly export function deliver(provider:LocationProvider):number{return provider.deliverFake(1,2,3,4);}
@NativeOnly export async function closeProvider(provider:LocationProvider):Promise<void>{await provider.close();}
export async function lifecycle():Promise<void>{await runProviderUpdates();}`,
    swiftSmoke: [
      "let perm = try permission()",
      'precondition(perm == "granted")',
      "let before = LucentLocationCounts.liveProviders",
      "let provider = try makeProvider()",
      "precondition(LucentLocationCounts.liveProviders == before + 1)",
      "let attached = try attach(provider: provider)",
      "precondition(attached == 1)",
      "let delivered = try deliver(provider: provider)",
      "precondition(delivered == 1)",
      "try await closeProvider(provider: provider)",
      "precondition(LucentLocationCounts.liveProviders == before)",
      "try await lifecycle()",
      'print("swift: location permission/updates/close passed")',
    ],
    kotlinSmoke: [
      'check(permission() == "granted")',
      "val before = LucentLocationCounts.liveProviders",
      "val provider = makeProvider()",
      "check(LucentLocationCounts.liveProviders == before + 1.0)",
      "check(attach(provider) == 1.0)",
      "check(deliver(provider) == 1.0)",
      "var closed = false",
      "val closing: suspend () -> Unit = { closeProvider(provider) }",
      block(
        "closing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closed = true }",
        ],
        "})",
      ),
      "while (!closed) Thread.yield()",
      "check(LucentLocationCounts.liveProviders == before)",
      "var lifecycleDone = false",
      "val owned: suspend () -> Unit = { lifecycle() }",
      block(
        "owned.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); lifecycleDone = true }",
        ],
        "})",
      ),
      "while (!lifecycleDone) Thread.yield()",
      'println("kotlin: location permission/updates/close passed")',
    ],
    swiftRace: [
      "let raceProvider = try makeProvider()",
      "_ = try attach(provider: raceProvider)",
      "let closeTask = Task { try await closeProvider(provider: raceProvider) }",
      "await Task.yield()",
      "_ = try? deliver(provider: raceProvider)",
      "try await closeTask.value",
      "precondition(raceProvider.closed)",
      'print("swift: location close-during-deliver race passed")',
    ],
    kotlinRace: [
      "val raceProvider = makeProvider()",
      "attach(raceProvider)",
      "var raceClosed = false",
      "val raceClosing: suspend () -> Unit = { closeProvider(raceProvider) }",
      block(
        "raceClosing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); raceClosed = true }",
        ],
        "})",
      ),
      "try { deliver(raceProvider) } catch (_: Throwable) {}",
      "while (!raceClosed) Thread.yield()",
      "check(raceProvider.closed)",
      'println("kotlin: location close-during-deliver race passed")',
    ],
  },
  {
    name: "background",
    libraries: { "@lucent-lang/background": BACKGROUND_LIBRARY },
    fileName: "background-package.lucent.ts",
    sources: { "schedule-job.lucent.ts": backgroundLucent },
    source: `import {BackgroundJobHandle,scheduledCount} from '@lucent-lang/background';
import {scheduleSyncJob} from './schedule-job.lucent';
@NativeOnly export function schedule():BackgroundJobHandle{return new BackgroundJobHandle("sync-records",1,"{\\"accountId\\":\\"a1\\"}",true);}
@NativeOnly export function count():number{return scheduledCount();}
@NativeOnly export async function closeJob(job:BackgroundJobHandle):Promise<void>{await job.close();}
export async function lifecycle():Promise<void>{await scheduleSyncJob();}`,
    swiftSmoke: [
      "let before = try count()",
      "let job = try schedule()",
      "let after = try count()",
      "precondition(after == before + 1)",
      "precondition(job.payloadVersion == 1)",
      "precondition(job.durable == true)",
      "try await closeJob(job: job)",
      "try await lifecycle()",
      'print("swift: background schedule/version/close passed")',
    ],
    kotlinSmoke: [
      "val before = count()",
      "val job = schedule()",
      "check(count() == before + 1.0)",
      "check(job.payloadVersion == 1.0)",
      "check(job.durable == true)",
      "var closed = false",
      "val closing: suspend () -> Unit = { closeJob(job) }",
      block(
        "closing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closed = true }",
        ],
        "})",
      ),
      "while (!closed) Thread.yield()",
      "var lifecycleDone = false",
      "val owned: suspend () -> Unit = { lifecycle() }",
      block(
        "owned.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); lifecycleDone = true }",
        ],
        "})",
      ),
      "while (!lifecycleDone) Thread.yield()",
      'println("kotlin: background schedule/version/close passed")',
    ],
    swiftRace: [
      "let raceJob = try schedule()",
      "let closeTask = Task { try await closeJob(job: raceJob) }",
      "await Task.yield()",
      "raceJob.cancel()",
      "try await closeTask.value",
      "precondition(raceJob.closed)",
      'print("swift: background close-during-cancel race passed")',
    ],
    kotlinRace: [
      "val raceJob = schedule()",
      "var raceClosed = false",
      "val raceClosing: suspend () -> Unit = { closeJob(raceJob) }",
      block(
        "raceClosing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); raceClosed = true }",
        ],
        "})",
      ),
      "raceJob.cancel()",
      "while (!raceClosed) Thread.yield()",
      "check(raceJob.closed)",
      'println("kotlin: background close-during-cancel race passed")',
    ],
  },
  {
    name: "streaming",
    libraries: { "@lucent-lang/streaming": STREAMING_LIBRARY },
    fileName: "streaming-package.lucent.ts",
    sources: { "pipeline.lucent.ts": streamingLucent },
    source: `import {FileChunkSource,FileWriteSink,transformChunk,liveBuffers} from '@lucent-lang/streaming';
import {runPipeline} from './pipeline.lucent';
@NativeOnly export function openSource():FileChunkSource{return new FileChunkSource("in.bin",8,4);}
@NativeOnly export function openSink():FileWriteSink{return new FileWriteSink("out.bin");}
@NativeOnly export async function read(source:FileChunkSource):Promise<Uint8Array>{return await source.readChunk();}
@NativeOnly export function transform(chunk:Uint8Array):Uint8Array{return transformChunk(chunk);}
@NativeOnly export async function write(sink:FileWriteSink,chunk:Uint8Array):Promise<void>{await sink.write(chunk);}
@NativeOnly export async function closeSource(source:FileChunkSource):Promise<void>{await source.close();}
@NativeOnly export async function closeSink(sink:FileWriteSink):Promise<void>{await sink.close();}
@NativeOnly export function buffers():number{return liveBuffers();}
export async function lifecycle():Promise<void>{await runPipeline();}`,
    swiftSmoke: [
      "let source = try openSource()",
      "let sink = try openSink()",
      "let chunk = try await read(source: source)",
      "let out = try transform(chunk: chunk)",
      "try await write(sink: sink, chunk: out)",
      "try await closeSource(source: source)",
      "try await closeSink(sink: sink)",
      "let live = try buffers()",
      "precondition(live >= 1)",
      "try await lifecycle()",
      'print("swift: streaming chunk/transform/write passed")',
    ],
    kotlinSmoke: [
      "val source = openSource()",
      "val sink = openSink()",
      "var chunk: ArrayBuffer? = null",
      "var readDone = false",
      "val reading: suspend () -> Unit = { chunk = read(source) }",
      block(
        "reading.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); readDone = true }",
        ],
        "})",
      ),
      "while (!readDone) Thread.yield()",
      "val out = transform(chunk!!)",
      "var writeDone = false",
      "val writing: suspend () -> Unit = { write(sink, out) }",
      block(
        "writing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); writeDone = true }",
        ],
        "})",
      ),
      "while (!writeDone) Thread.yield()",
      "var closedSource = false",
      "val closingSource: suspend () -> Unit = { closeSource(source) }",
      block(
        "closingSource.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closedSource = true }",
        ],
        "})",
      ),
      "while (!closedSource) Thread.yield()",
      "var closedSink = false",
      "val closingSink: suspend () -> Unit = { closeSink(sink) }",
      block(
        "closingSink.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closedSink = true }",
        ],
        "})",
      ),
      "while (!closedSink) Thread.yield()",
      "check(buffers() >= 1.0)",
      "var lifecycleDone = false",
      "val owned: suspend () -> Unit = { lifecycle() }",
      block(
        "owned.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); lifecycleDone = true }",
        ],
        "})",
      ),
      "while (!lifecycleDone) Thread.yield()",
      'println("kotlin: streaming chunk/transform/write passed")',
    ],
    swiftRace: [
      "let raceSource = try openSource()",
      "let readTask = Task { try? await read(source: raceSource) }",
      "await Task.yield()",
      "try await closeSource(source: raceSource)",
      "_ = await readTask.value",
      "precondition(raceSource.closed)",
      'print("swift: streaming close-during-read race passed")',
    ],
    kotlinRace: [
      "val raceSource = openSource()",
      "var raceReadDone = false",
      "val raceReading: suspend () -> Unit = { try { read(raceSource) } catch (_: Throwable) {} }",
      block(
        "raceReading.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { raceReadDone = true }",
        ],
        "})",
      ),
      "Thread.yield()",
      "var raceClosed = false",
      "val raceClosing: suspend () -> Unit = { closeSource(raceSource) }",
      block(
        "raceClosing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); raceClosed = true }",
        ],
        "})",
      ),
      "while (!raceReadDone || !raceClosed) Thread.yield()",
      "check(raceSource.closed)",
      'println("kotlin: streaming close-during-read race passed")',
    ],
  },
];

function runSwift(name: string, module: NonNullable<ReturnType<typeof compile>["module"]>, body: Doc[]) {
  const harness = sections([block("@main struct Runner {", [block("static func main() async throws {", body)])]);
  const source = renderSwiftVerifyProgram(module, harness);
  const file = join(dir, `${name}.swift`);
  writeFileSync(file, source);
  execFileSync(
    "swiftc",
    ["-parse-as-library", "-module-cache-path", join(dir, `${name}-cache`), file, "-o", join(dir, `${name}-swift`)],
    { stdio: "pipe", timeout: 120000 },
  );
  process.stdout.write(execFileSync(join(dir, `${name}-swift`), { timeout: 30000 }));
}

function runKotlin(name: string, module: NonNullable<ReturnType<typeof compile>["module"]>, body: Doc[]) {
  const harness = sections([block("fun main() {", body)]);
  const source = renderKotlinVerifyProgram(module, harness, ["import kotlin.coroutines.startCoroutine"]);
  const file = join(dir, `${name}.kt`);
  writeFileSync(file, source);
  execFileSync("kotlinc", [file, "-include-runtime", "-d", join(dir, `${name}.jar`)], {
    stdio: "pipe",
    timeout: 120000,
  });
  process.stdout.write(execFileSync(javaBin, ["-jar", join(dir, `${name}.jar`)], { timeout: 30000 }));
}

for (const pkg of packages) {
  const result = compile(pkg.source, {
    fileName: pkg.fileName,
    ...(pkg.sources ? { sources: pkg.sources } : {}),
    libraries: pkg.libraries,
  });
  if (!result.module) throw new Error(`${pkg.name}: ${JSON.stringify(result.diagnostics)}`);
  console.log(`✓ compiled ${pkg.name}`);
  runSwift(pkg.name, result.module, [...pkg.swiftSmoke, ...pkg.swiftRace]);
  runKotlin(pkg.name, result.module, [...pkg.kotlinSmoke, ...pkg.kotlinRace]);
}

console.log("✓ gate C packages: bluetooth, sqlite, location, background, streaming");

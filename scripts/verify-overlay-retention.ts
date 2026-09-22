/**
 * Overlay retention contract: bluetooth notifications use retention
 * "subscription" (lucent-overlay.json). Prove the callback is retained across
 * deliveries until close, matching the overlay claim.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { BLUETOOTH_LIBRARY } from "../packages/bluetooth/src/library.ts";
import { validateOverlay } from "../packages/sdk/src/index.ts";
import {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
} from "./lib/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const overlay = JSON.parse(readFileSync(join(root, "packages/bluetooth/lucent-overlay.json"), "utf8"));
const overlayErrors = validateOverlay(overlay);
if (overlayErrors.length) throw new Error(overlayErrors.join("\n"));
const notifications = overlay.callbacks?.["BluetoothConnection.notifications"];
if (notifications?.retention !== "subscription") {
  throw new Error("overlay claim expected retention: subscription for notifications");
}

const result = compile(
  `import {BluetoothScanner,BluetoothConnection} from '@lucent-lang/bluetooth';
@NativeOnly export function makeScanner():BluetoothScanner{return new BluetoothScanner();}
@NativeOnly export function start(scanner:BluetoothScanner):void{scanner.start();}
@NativeOnly export async function connect(scanner:BluetoothScanner):Promise<BluetoothConnection>{return await scanner.connect("fake-1");}
@NativeOnly export function attach(connection:BluetoothConnection):number{
  return connection.notifications("c1",(payload:Uint8Array):number=>payload.length);
}
@NativeOnly export function deliver(connection:BluetoothConnection,payload:Uint8Array):number{
  return connection.deliverNotification("c1",payload);
}
@NativeOnly export async function closeConnection(connection:BluetoothConnection):Promise<void>{await connection.close();}
@NativeOnly export async function closeScanner(scanner:BluetoothScanner):Promise<void>{await scanner.close();}`,
  {
    fileName: "overlay-retention.lucent.ts",
    libraries: { "@lucent-lang/bluetooth": BLUETOOTH_LIBRARY },
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-overlay-retention-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let scanner = try makeScanner()",
      "try start(scanner: scanner)",
      "let connection = try await connect(scanner: scanner)",
      'precondition(connection.connectionState == "connected")',
      "_ = try attach(connection: connection)",
      "let a = try deliver(connection: connection, payload: try LucentBytes.fromData(Data([1,2,3])))",
      "let b = try deliver(connection: connection, payload: try LucentBytes.fromData(Data([4,5])))",
      "precondition(a == 3)",
      "precondition(b == 2)",
      "try await closeConnection(connection: connection)",
      "do {",
      "  _ = try deliver(connection: connection, payload: try LucentBytes.fromData(Data([9])))",
      '  preconditionFailure("expected closed after close")',
      "} catch {",
      "  // subscription released",
      "}",
      "try await closeScanner(scanner: scanner)",
      'print("swift: overlay subscription retention matched")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val scanner = makeScanner()",
    "start(scanner)",
    "var connection: LucentBluetoothConnection? = null",
    "var connected = false",
    "val connecting: suspend () -> Unit = { connection = connect(scanner) }",
    block(
      "connecting.startCoroutine(object: Continuation<Unit> {",
      [
        "override val context = kotlin.coroutines.EmptyCoroutineContext",
        "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); connected = true }",
      ],
      "})",
    ),
    "while (!connected) Thread.yield()",
    'check(connection!!.connectionState == "connected")',
    "attach(connection!!)",
    "check(deliver(connection!!, byteArrayOf(1, 2, 3)) == 3.0)",
    "check(deliver(connection!!, byteArrayOf(4, 5)) == 2.0)",
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
    "var rejected = false",
    block("try {", ["deliver(connection!!, byteArrayOf(9))"], "} catch (_: Throwable) { rejected = true }"),
    "check(rejected)",
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
    'println("kotlin: overlay subscription retention matched")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);

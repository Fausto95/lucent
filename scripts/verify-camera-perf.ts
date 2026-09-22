/**
 * Camera frame-processing latency harness (CI stub).
 * Measures synthetic deliverSynthetic latency for N frames; prints p50/p95;
 * writes results under packages/bench/results/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { CAMERA_LIBRARY } from "../packages/camera/src/library.ts";
import {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
} from "./lib/index.ts";

const FRAME_COUNT = 200;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const resultsDir = join(root, "packages/bench/results");
mkdirSync(resultsDir, { recursive: true });

const result = compile(
  `import {CameraSession,Frame} from '@lucent-lang/camera';
@NativeOnly export function make():CameraSession{return new CameraSession();}
@NativeOnly export function start(session:CameraSession):void{session.start();}
@NativeOnly export function attach(session:CameraSession):number{
  return session.frames((frame:Frame):number=>frame.width+frame.height);
}
@NativeOnly export function deliver(session:CameraSession,bytes:number[],width:number,height:number,rowStride:number,pixelStride:number):number{
  return session.deliverSynthetic(bytes,width,height,rowStride,pixelStride);
}
@NativeOnly export async function close(session:CameraSession):Promise<void>{await session.close();}`,
  {
    fileName: "camera-perf.lucent.ts",
    libraries: { "@lucent-lang/camera": CAMERA_LIBRARY },
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-camera-perf-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let session = try make()",
      "try start(session: session)",
      "_ = try attach(session: session)",
      "var samples: [Double] = []",
      `samples.reserveCapacity(${FRAME_COUNT})`,
      `for _ in 0..<${FRAME_COUNT} {`,
      "  let t0 = DispatchTime.now().uptimeNanoseconds",
      "  _ = try deliver(session: session, bytes: [1,2,3,4].map { Double($0) }, width: 2, height: 2, rowStride: 4, pixelStride: 1)",
      "  let t1 = DispatchTime.now().uptimeNanoseconds",
      "  samples.append(Double(t1 - t0) / 1_000_000.0)",
      "}",
      "try await close(session: session)",
      "samples.sort()",
      `let p50 = samples[${Math.floor(FRAME_COUNT * 0.5)}]`,
      `let p95 = samples[${Math.floor(FRAME_COUNT * 0.95)}]`,
      'print("swift: camera-perf p50_ms=\\(p50) p95_ms=\\(p95) n=\\(samples.count)")',
      'print("PERF_JSON {\\"backend\\":\\"swift\\",\\"p50_ms\\":\\(p50),\\"p95_ms\\":\\(p95),\\"n\\":\\(samples.count)}")',
    ]),
  ]),
]);

const swiftOut = writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)).toString("utf8");
process.stdout.write(swiftOut);

const kotlinHarness = sections([
  block("fun main() {", [
    "val session = make()",
    "start(session)",
    "attach(session)",
    "val samples = mutableListOf<Double>()",
    block(`repeat(${FRAME_COUNT}) {`, [
      "val t0 = System.nanoTime()",
      "deliver(session, mutableListOf(1.0, 2.0, 3.0, 4.0), 2.0, 2.0, 4.0, 1.0)",
      "val t1 = System.nanoTime()",
      "samples.add((t1 - t0) / 1_000_000.0)",
    ]),
    "val closing: suspend () -> Unit = { close(session) }",
    "var closed = false",
    block(
      "closing.startCoroutine(object: Continuation<Unit> {",
      [
        "override val context = kotlin.coroutines.EmptyCoroutineContext",
        "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closed = true }",
      ],
      "})",
    ),
    "while (!closed) Thread.yield()",
    "samples.sort()",
    `val p50 = samples[${Math.floor(FRAME_COUNT * 0.5)}]`,
    `val p95 = samples[${Math.floor(FRAME_COUNT * 0.95)}]`,
    'println("kotlin: camera-perf p50_ms=$p50 p95_ms=$p95 n=${samples.size}")',
    'println("PERF_JSON {\\"backend\\":\\"kotlin\\",\\"p50_ms\\":$p50,\\"p95_ms\\":$p95,\\"n\\":${samples.size}}")',
  ]),
]);

const kotlinOut = writeAndRunKotlin(
  paths,
  renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
).toString("utf8");
process.stdout.write(kotlinOut);

function parsePerf(line: string): Record<string, unknown> | null {
  const marker = "PERF_JSON ";
  const idx = line.indexOf(marker);
  if (idx < 0) return null;
  return JSON.parse(line.slice(idx + marker.length)) as Record<string, unknown>;
}

const results = [...swiftOut.split("\n"), ...kotlinOut.split("\n")]
  .map(parsePerf)
  .filter((v): v is Record<string, unknown> => v !== null);

const payload = {
  workload: "camera-frame-synthetic",
  frameCount: FRAME_COUNT,
  provisional: true,
  note: "Budgets in docs/budgets.md remain baseline TBD; these are CI stub measurements.",
  results,
  measuredAt: new Date().toISOString(),
};

const outFile = join(resultsDir, "camera-frame-latency.json");
writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`wrote ${outFile}`);

/** Compile @lucent-lang/camera and exercise session close + synthetic frames on both toolchains. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const luminance = readFileSync(join(root, "packages/camera/lucent/luminance.lucent.ts"), "utf8");
const lifecycle = readFileSync(join(root, "packages/camera/lucent/session-lifecycle.lucent.tsx"), "utf8");

const libraries = { "@lucent-lang/camera": CAMERA_LIBRARY };

const lifecycleResult = compile(lifecycle, {
  fileName: "session-lifecycle.lucent.tsx",
  libraries,
});
if (!lifecycleResult.module) throw new Error(JSON.stringify(lifecycleResult.diagnostics));
const lifecycleFn = lifecycleResult.module.functions.find((f) => f.name === "SessionLifecycle");
if (!lifecycleFn?.resources?.some((r) => r.close === "close")) {
  throw new Error("SessionLifecycle must declare a resource() slot with close");
}
if (!lifecycleFn.effectSlots?.length) {
  throw new Error("SessionLifecycle must declare an effect() slot");
}

const result = compile(
  `import {CameraSession,Frame} from '@lucent-lang/camera';
import {luminance} from './luminance.lucent';
@NativeOnly export function attach(session:CameraSession):number{
  return session.frames((frame:Frame):number=>luminance(frame));
}
@NativeOnly export function make():CameraSession{return new CameraSession();}
@NativeOnly export function start(session:CameraSession):void{session.start();}
@NativeOnly export function stop(session:CameraSession):void{session.stop();}
@NativeOnly export function attachProcessor(session:CameraSession):number{return attach(session);}
@NativeOnly export function deliver(session:CameraSession,bytes:number[],width:number,height:number,rowStride:number,pixelStride:number):number{
  return session.deliverSynthetic(bytes,width,height,rowStride,pixelStride);
}
@NativeOnly export async function close(session:CameraSession):Promise<void>{await session.close();}`,
  {
    fileName: "camera-package.lucent.ts",
    sources: { "luminance.lucent.ts": luminance },
    libraries,
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;

const paths = createNativeHarnessDir("lucent-camera-package-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let before = LucentCameraCounts.liveSessions",
      "let session = try make()",
      "precondition(LucentCameraCounts.liveSessions == before + 1)",
      "try start(session: session)",
      "let attached = try attachProcessor(session: session)",
      "precondition(attached == 1)",
      "let mean = try deliver(session: session, bytes: [10, 255, 20, 255, 255, 255, 30, 255, 40].map { Double($0) }, width: 2, height: 2, rowStride: 6, pixelStride: 2)",
      "precondition(mean == 25)",
      "precondition(LucentCameraCounts.liveFrames == 0)",
      "try stop(session: session)",
      "try await close(session: session)",
      "precondition(LucentCameraCounts.liveSessions == before)",
      'print("swift: camera package session close, borrowed luminance frame, and resource slot passed")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val before = LucentCameraCounts.liveSessions",
    "val session = make()",
    "check(LucentCameraCounts.liveSessions == before + 1.0)",
    "start(session)",
    "check(attachProcessor(session) == 1.0)",
    "val mean = deliver(session, mutableListOf(10.0, 255.0, 20.0, 255.0, 255.0, 255.0, 30.0, 255.0, 40.0), 2.0, 2.0, 6.0, 2.0)",
    "check(mean == 25.0)",
    "check(LucentCameraCounts.liveFrames == 0.0)",
    "stop(session)",
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
    "check(LucentCameraCounts.liveSessions == before)",
    'println("kotlin: camera package session close, borrowed luminance frame, and resource slot passed")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);

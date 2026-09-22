/**
 * Camera start/stop/close race using FakeBarrier via FakeResource.work
 * (hold until complete). Rapid cycles must leave counters at baseline.
 */
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { CAMERA_LIBRARY } from "../packages/camera/src/library.ts";
import { FAKE_SDK_LIBRARY } from "../packages/fake-sdk/src/library.ts";
import {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
} from "./lib/index.ts";

const libraries = {
  "@lucent-lang/camera": CAMERA_LIBRARY,
  "@lucent-lang/fake-sdk": FAKE_SDK_LIBRARY,
};

const result = compile(
  `import {CameraSession} from '@lucent-lang/camera';
import {FakeBarrier,FakeResource} from '@lucent-lang/fake-sdk';
@NativeOnly export function make():CameraSession{return new CameraSession();}
@NativeOnly export function start(session:CameraSession):void{session.start();}
@NativeOnly export function stop(session:CameraSession):void{session.stop();}
@NativeOnly export async function close(session:CameraSession):Promise<void>{await session.close();}
@NativeOnly export function makeBarrier():FakeBarrier{return new FakeBarrier();}
@NativeOnly export function makeResource():FakeResource{return new FakeResource();}
@NativeOnly export async function awaitStarted(barrier:FakeBarrier):Promise<void>{await barrier.started();}
@NativeOnly export function completeBarrier(barrier:FakeBarrier):void{barrier.complete();}
@NativeOnly export async function runWork(resource:FakeResource,barrier:FakeBarrier):Promise<void>{await resource.work(barrier);}
@NativeOnly export async function closeResource(resource:FakeResource):Promise<void>{await resource.close();}`,
  {
    fileName: "camera-race.lucent.ts",
    libraries,
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-camera-race-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let beforeSessions = LucentCameraCounts.liveSessions",
      "let beforeFrames = LucentCameraCounts.liveFrames",
      "for _ in 0..<40 {",
      "  let session = try make()",
      "  let barrier = try makeBarrier()",
      "  let resource = try makeResource()",
      "  let worker = Task {",
      "    try start(session: session)",
      "    try stop(session: session)",
      "    try start(session: session)",
      "    try await runWork(resource: resource, barrier: barrier)",
      "    try stop(session: session)",
      "  }",
      "  try await awaitStarted(barrier: barrier)",
      "  let closing = Task { try await close(session: session) }",
      "  try completeBarrier(barrier: barrier)",
      "  _ = try await worker.value",
      "  try await closing.value",
      "  try await closeResource(resource: resource)",
      "}",
      "precondition(LucentCameraCounts.liveSessions == beforeSessions)",
      "precondition(LucentCameraCounts.liveFrames == beforeFrames)",
      'print("swift: camera start/stop/close FakeBarrier race passed")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val beforeSessions = LucentCameraCounts.liveSessions",
    "val beforeFrames = LucentCameraCounts.liveFrames",
    block("repeat(40) {", [
      "val session = make()",
      "val barrier = makeBarrier()",
      "val resource = makeResource()",
      "var workerDone = false",
      "val worker: suspend () -> Unit = {",
      "  start(session)",
      "  stop(session)",
      "  start(session)",
      "  runWork(resource, barrier)",
      "  stop(session)",
      "}",
      block(
        "worker.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); workerDone = true }",
        ],
        "})",
      ),
      "var started = false",
      "val waiting: suspend () -> Unit = { awaitStarted(barrier) }",
      block(
        "waiting.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); started = true }",
        ],
        "})",
      ),
      "while (!started) Thread.yield()",
      "var closed = false",
      "val closing: suspend () -> Unit = { close(session) }",
      block(
        "closing.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); closed = true }",
        ],
        "})",
      ),
      "completeBarrier(barrier)",
      "while (!workerDone || !closed) Thread.yield()",
      "var resourceClosed = false",
      "val closingResource: suspend () -> Unit = { closeResource(resource) }",
      block(
        "closingResource.startCoroutine(object: Continuation<Unit> {",
        [
          "override val context = kotlin.coroutines.EmptyCoroutineContext",
          "override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); resourceClosed = true }",
        ],
        "})",
      ),
      "while (!resourceClosed) Thread.yield()",
    ]),
    "check(LucentCameraCounts.liveSessions == beforeSessions)",
    "check(LucentCameraCounts.liveFrames == beforeFrames)",
    'println("kotlin: camera start/stop/close FakeBarrier race passed")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);

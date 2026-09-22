/**
 * Camera stress stub: 100 create/close cycles with live session and frame
 * counters returning to baseline. Uses the codegen verify harness.
 */
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

const result = compile(
  `import {CameraSession} from '@lucent-lang/camera';
@NativeOnly export function make():CameraSession{return new CameraSession();}
@NativeOnly export async function close(session:CameraSession):Promise<void>{await session.close();}`,
  {
    fileName: "camera-stress.lucent.ts",
    libraries: { "@lucent-lang/camera": CAMERA_LIBRARY },
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-camera-stress-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let beforeSessions = LucentCameraCounts.liveSessions",
      "let beforeFrames = LucentCameraCounts.liveFrames",
      "for _ in 0..<100 {",
      "  let session = try make()",
      "  try await close(session: session)",
      "}",
      "precondition(LucentCameraCounts.liveSessions == beforeSessions)",
      "precondition(LucentCameraCounts.liveFrames == beforeFrames)",
      'print("swift: camera stress 100 create/close cycles passed (sessions+frames baseline)")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val beforeSessions = LucentCameraCounts.liveSessions",
    "val beforeFrames = LucentCameraCounts.liveFrames",
    block("repeat(100) {", [
      "val session = make()",
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
    ]),
    "check(LucentCameraCounts.liveSessions == beforeSessions)",
    "check(LucentCameraCounts.liveFrames == beforeFrames)",
    'println("kotlin: camera stress 100 create/close cycles passed (sessions+frames baseline)")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);

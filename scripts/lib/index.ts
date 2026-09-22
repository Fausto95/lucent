/**
 * Shared verify harness emission via @lucent-lang/codegen.
 *
 * Rules:
 * - Hand-written SDK / runner sources live under package native/ folders or
 *   scripts/native/ as real .swift / .kt files.
 * - Composition uses Doc / block / sections / render and fillNative.
 * - Never assemble Swift/Kotlin with TypeScript template literals that invent
 *   braces or indentation.
 */
export {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
  type NativeHarnessPaths,
  type NativeVerifyModule,
} from "./native-harness.ts";

export {
  assembleSections,
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  hoistKotlinImports,
  packageSources,
  readNativeTemplate,
} from "./verify-harness.ts";

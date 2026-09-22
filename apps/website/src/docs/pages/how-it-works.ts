import { BuildDiagram } from "../../components/diagrams/BuildDiagram";
import { LayeringDiagram } from "../../components/diagrams/LayeringDiagram";
import { PipelineDiagram } from "../../components/diagrams/PipelineDiagram";
import { RuntimeDiagram } from "../../components/diagrams/RuntimeDiagram";
import { ViewsDiagram } from "../../components/diagrams/ViewsDiagram";
import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "how-it-works",
  title: "How it works",
  description:
    "From a `*.lucent.ts` file to a native package, and from a JavaScript call to compiled Swift or Kotlin. No JavaScript runs on the native side.",
  blocks: [
    { kind: "h2", text: "The pipeline" },
    {
      kind: "p",
      text: "One source file goes through four pure phases, then two backends, then a host. Each phase stops the build on its first error and reports an `NT` diagnostic with a code frame.",
    },
    { kind: "diagram", component: PipelineDiagram },
    {
      kind: "table",
      head: ["Phase", "Input → output", "Notes"],
      rows: [
        ["Parse", "text → surface AST", "[oxc-parser](https://oxc.rs/) for TypeScript syntax. Unsupported nodes are `NT1001`, not a crash."],
        ["Check", "AST → typed AST", "Scopes, inference of locals, assignability, arity, narrowing of optionals and union tags, capability and platform checks."],
        ["Lower", "typed AST → IR", "Removes what only JavaScript has: `for(;;)` becomes `while`, `a += b` becomes an assignment, template strings become `concat`."],
        ["Backends", "IR → Swift / Kotlin text", "A lookup table per type. Backends never see TypeScript names."],
        ["Host", "bodies → package", "Wraps functions as an Expo `Module` or a Nitro `HybridObject`, writes the JS proxy and `.d.ts`, plus podspec, Gradle, manifests."],
      ],
    },
    {
      kind: "p",
      text: "The IR is typed and keeps structured control flow (`if`, `while`, `forEach`, `return`, `throw`). Swift and Kotlin have no `goto`, so a basic-block CFG would only have to be re-structured on the way out. Run `lucent build --emit-ir` to write it to `.lucent/ir/`.",
    },
    {
      kind: "tabs",
      tabs: [
        {
          label: "Source",
          filename: "clamp.lucent.ts",
          code: "export function clamp(value: number, min: number, max: number): number {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}",
        },
        {
          label: "IR",
          filename: "clamp.ir.txt",
          code: "module clamp\n\nexport fn clamp(value: float64, min: float64, max: float64) -> float64\n  if (lt value min)\n    return min\n  if (gt value max)\n    return max\n  return value",
        },
        {
          label: "Swift",
          filename: "ios/LucentClampModule.swift",
          code: 'import ExpoModulesCore\n\n@ExpoModule("Lucent_clamp")\npublic final class LucentClampModule: Module {\n  @JS\n  func clamp(value: Double, min: Double, max: Double) throws -> Double {\n    if value < min {\n      return min\n    }\n    if value > max {\n      return max\n    }\n    return value\n  }\n}',
        },
        {
          label: "Kotlin",
          filename: "android/…/LucentClampModule.kt",
          code: 'class LucentClampModule : Module() {\n  override fun definition() = ModuleDefinition {\n    Name("Lucent_clamp")\n\n    Function("clamp") { value: Double, min: Double, max: Double ->\n      clamp(value, min, max)\n    }\n  }\n\n  private fun clamp(value: Double, min: Double, max: Double): Double {\n    if (value < min) {\n      return min\n    }\n    if (value > max) {\n      return max\n    }\n    return value\n  }\n}',
        },
        {
          label: "Proxy",
          filename: "clamp.lucent.js",
          code: 'import { requireNativeModule } from "expo-modules-core";\nimport { lucentCall } from "@lucent-lang/runtime";\n\nconst native = requireNativeModule("Lucent_clamp");\n\nexport function clamp(value, min, max) {\n  return lucentCall(() => native.clamp(value, min, max));\n}',
        },
      ],
    },
    { kind: "h2", text: "In your build" },
    {
      kind: "p",
      text: "Lucent touches the build in two places. Native generation runs when native code changes; the Metro transformer runs every time the bundle is built.",
    },
    { kind: "diagram", component: BuildDiagram },
    {
      kind: "list",
      items: [
        "**Native generation.** `lucent build`, or the Expo config plugin during `expo prebuild`, discovers every `.lucent.ts(x)` under the project, resolves imports between them, compiles, and writes the package: `modules/lucent/` for Expo, `.lucent/nitro/` for Nitro. Output files are only rewritten when their contents change, so Xcode and Gradle see minimal diffs.",
        "**Cache.** Each module's IR is cached in `.lucent/cache.json` under a hash of the source, the compiler version and the host. Dependencies and bindings are part of the hash, so editing an imported file invalidates its importers.",
        "**Metro.** `withLucent()` installs a Babel transformer wrapper. For a Lucent file it compiles in-process, replaces the source with the host's JS proxy, and hands that to the upstream Expo or React Native transformer. Compile errors surface as Metro errors with the Lucent code frame. The cache key includes the compiler version and host.",
      ],
    },
    { kind: "h2", text: "At runtime" },
    {
      kind: "p",
      text: "The proxy is a few lines per function. It looks up the native module by name and calls it through the host's JSI binding, wrapping the call in `lucentCall` so that any failure becomes a `LucentError` with the original `code`, `message` and `metadata`.",
    },
    { kind: "diagram", component: RuntimeDiagram },
    {
      kind: "table",
      head: ["Value", "Across the boundary"],
      rows: [
        ["`number`, `string`, `boolean`", "Passed directly."],
        ["records, arrays, maps", "Copied. Expo uses `Record`s; Nitro uses generated struct converters."],
        ["`Uint8Array`", "Passed as an `ArrayBuffer`. Sync functions may read it in place; async functions get a copy."],
        ["optionals", "`null` and `undefined` in JS, `nil`/`null` in native."],
        ["native classes", "An opaque handle. Methods run on the same native object; `dispose()` releases it."],
        ["`Promise<T>`", "Swift `async`, Kotlin `suspend`. Thread hops (`@Background`, `@MainThread`) are always async."],
        ["thrown `LucentError`", "Serialized in an envelope and rebuilt on the JS side, identically for both hosts."],
      ],
    },
    { kind: "h2", text: "Native views" },
    {
      kind: "p",
      text: "A `.lucent.tsx` export is a function from props to a view tree. The backends turn it into a SwiftUI `View` and a `@Composable`; the host mounts it in an Expo view or a Nitro Fabric view. React renders the host view, passes props, and receives `Event<T>` callbacks. `state()` lives on that host instance, so a control survives the next prop update. React still owns everything else.",
    },
    { kind: "diagram", component: ViewsDiagram },
    { kind: "h2", text: "Generated files" },
    {
      kind: "p",
      text: "The output is a build product. Expo writes `modules/lucent/`. Nitro writes `.lucent/nitro/`. The next build overwrites both. Do not edit those files: there is no merge, and no source map from a native stack frame back to a `.lucent.ts` line. A thrown `LucentError` arrives in JavaScript as an error with `code`, `message`, and scalar `metadata`. Anything else is a native exception in Xcode or logcat.",
    },
    {
      kind: "p",
      text: "Unchanged modules are cached, so a rebuild does not recompile every file. `lucent check` reports diagnostics without writing Swift or Kotlin. `pnpm verify` in this repository compiles the golden fixtures with `swiftc` and `kotlinc`; an app still needs a Mac for the iOS build.",
    },
    { kind: "h2", text: "Architecture" },
    {
      kind: "p",
      text: "The repository is a pnpm workspace. Dependencies flow one way: integrations know hosts, hosts know backends and their SDK, backends know the IR, the compiler knows only the parser.",
    },
    { kind: "diagram", component: LayeringDiagram },
    {
      kind: "table",
      head: ["Package", "Role"],
      rows: [
        ["`compiler`", "Pure. `compile(source, { fileName, sources, libraries })` → `{ module, diagnostics }`."],
        ["`backend-swift`, `backend-kotlin`", "IR → source text for function bodies, structs, classes, events, views."],
        ["`host-core`", "The `Host` interface, config loading, `.d.ts` generation, native package wiring."],
        ["`host-expo`, `host-nitro`", "Module wrappers, view hosting, proxies and package files for each target."],
        ["`cli`, `metro`, `expo`", "`lucent` command, `withLucent()`, the config plugin."],
        ["`runtime`", "`LucentError`, `lucentCall`, buffer helpers. The only package the proxy imports at runtime."],
        ["`sdk`", "`lucent sdk`: extract bindings from `.swiftinterface` files and `android.jar`."],
        ["`types`, `objects`, `events`, `ui`, `std`, `platform`, `core`, `crypto`, `filesystem`, `network`, `device`, `config`", "Declaration-only packages for the editor. See the [API reference](/docs/api/)."],
      ],
    },
    {
      kind: "p",
      text: "Fixtures in `fixtures/` are the contract between the layers: each `<name>.lucent.ts` has golden `.ir.txt`, `.swift`, `.kt` and host output, and `pnpm verify` type-checks the generated Swift and Kotlin with `swiftc` and `kotlinc`.",
    },
  ],
};

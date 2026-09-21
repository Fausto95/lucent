# Lucent

Ahead-of-time compiler from a constrained TypeScript subset to Swift and Kotlin,
exposed to React Native through **Expo Modules** (SDK 58) or **Nitro Modules**
(bare RN). You write `*.lucent.ts`; nothing in it ever runs in a JS engine.

```
*.lucent.ts ──► @lucent/compiler ──► IR ──► @lucent/backend-swift ──► Swift bodies
                                        └─► @lucent/backend-kotlin ─► Kotlin bodies
                                                    │
                                        ├─► @lucent/host-expo   (Expo Module + JS proxy)
                                        └─► @lucent/host-nitro  (Nitro HybridObject + JS proxy)
                                                    │
                                       @lucent/metro  · @lucent/expo · @lucent/cli
```

Dependency direction is one way: `cli / expo / metro → host-* → backend-* → compiler → oxc-parser`.
The language contract is in [docs/language.md](docs/language.md). Working rules
for contributors and agents are in [AGENTS.md](AGENTS.md); the full design
rationale and verified external API contracts are in the plan referenced there.

## Requirements

- Bun 1.4+, Node 24 (for oxc-parser's napi binding)
- Xcode 27 with an iOS 26 simulator, `swiftc`
- `kotlinc` (`brew install kotlin`) and a JDK
- Android SDK with an emulator image (for the Android end-to-end check)

```sh
bun install
bun test              # unit + golden tests
bun run typecheck
bun run verify        # + compiles every fixture's Swift and Kotlin
```

## Roadmap / hand-off checklist

Status legend: `[x]` done and committed · `[~]` in progress · `[ ]` not started.
Each item names the package and the commit(s) that deliver it. Tests are
committed red before the implementation commit that turns them green.

### 0. Repository

- [x] Bun workspace, strict `tsconfig`, `.gitignore`, `AGENTS.md` — `chore: scaffold bun workspace and strict tsconfig`
- [x] `docs/language.md` v1 language contract — `docs: define the Lucent language subset`
- [x] Git remote `github.com/Fausto95/lucent`, no AI co-author trailers in commits
- [x] `scripts/doctor.ts` — checks bun, node, swiftc, kotlinc, xcodebuild, java, adb
- [~] README kept in sync with progress (this list)

### 1. `packages/compiler` — pure, no IO

Public API: `compile(source, { fileName }) → { module: IRModule | null, diagnostics }`.

- [x] Red tests: `test/parser.test.ts`, `test/types.test.ts`
- [x] `src/diagnostics/` — `Diagnostic { code, message, span, help? }`, code table (`NT1000`–`NT1016`), `renderDiagnostic(d, source, fileName)` codeframe renderer
- [x] `src/parser/surface.ts` — closed surface AST (types, statements, expressions); the only place ESTree is visible is `src/parser/index.ts`
- [x] `src/parser/index.ts` — `parseModule(source, fileName)` on `oxc-parser` `parseSync(lang:"ts")`; maps oxc errors → `NT1000`, unsupported nodes → `NT1001`, foreign imports → `NT1006`
- [x] `src/types/native-type.ts` — `NativeType` union (`void bool string bytes float{32,64} int{8..64,signed} array map optional struct promise`), `typeToString`, `typeEquals`
- [x] `src/types/resolve.ts` — `resolveType(SurfaceType, scope)` lookup-table resolver; `NT1003/NT1004/NT1005`
- [x] Red tests: `test/checker.test.ts` — scopes, inference from initializer, assignability, arity, `await` in async only, `Promise` only as async return, struct field access, dynamic access `NT1002`, missing annotation `NT1014`, missing return `NT1015`, const assignment `NT1016`, > 8 params `NT1007`
- [x] `src/checker/` — typed surface AST (every expression annotated with `NativeType`), module symbol table (structs, functions, sized types imported from `@lucent/types`)
- [x] Red tests: `test/lowering.test.ts` — golden IR text for `fixtures/*.lucent.ts`
- [x] `src/ir/` — structured, typed IR (`IRStmt` / `IRExpr` / `IRPlace`) and `printIR` text form; see [docs/ir.md](docs/ir.md) for why it is not a CFG
- [x] `src/lowering/` — typed AST → IR: unique locals, param shadows, `for` → `while`, `for…of` → `forEach`, compound assignment/update expansion, template → `concat`/`str`
- [ ] `src/passes/` — constant folding (small, optional; not needed for v1)
- [x] `src/index.ts` — `compile()` wiring all phases; stops after the first phase that produced errors
- [x] `fixtures/` — `add`, `fibonacci`, `clamp`, `async-sum`, `struct-roundtrip`, `bytes`, `throw`, `kitchen`, `diagnostics/*` with golden `.ir.txt` / `.diag.txt`

### 2. `packages/backend-swift`, `packages/backend-kotlin` — IR → source text

Both expose `generate(module: IRModule): GeneratedUnit { structs, functions, imports }` (bodies only, no host wrapper).

- [x] Red tests: golden `fixtures/<name>.swift` and `.kt`
- [x] `types.ts` — `NativeType → string` lookup (`Double/Double`, `[T]/List<T>`, `T?/T?`, `[String:T]/Map<String,T>`, `ArrayBuffer/ArrayBuffer`)
- [x] Emitters — one file per backend (`src/index.ts`), `let`/`var` from IR mutability, `async throws` / `suspend`, statement-level `try`/`try await` in Swift, labeled Swift calls, `throw LucentError(...)`
- [x] Runtime prelude contract: `LucentError`, `LucentBytes.length/get`, `lucentStr` — hosts supply the `ArrayBuffer` accessors via `swiftRuntime(...)` / `kotlinRuntime(...)`
- [x] Number semantics: `%` as `truncatingRemainder`/`%`, string `+` concat, sized-int wrapping ops (`&+` in Swift), JS-style number formatting in `lucentStr`
- [x] `scripts/verify-native.ts` — for each fixture, `swiftc -typecheck` and `kotlinc -nowarn` the generated file plus a stub prelude (`ArrayBuffer` = byte array); wired into `bun run verify`

### 3. `packages/host-expo` — Expo SDK 58

- [x] `packages/host-core`: `Host` interface (`emitPackage(modules) → FileTree`, `emitProxy(module) → { js, dts }`), `.d.ts` generation, boundary conversion helpers; `packages/runtime` (`@lucent/runtime`): `LucentError`, `lucentCall`, `toArrayBuffer`/`fromArrayBuffer`, error normalisation for both hosts
- [x] Swift: `@ExpoModule("Lucent_<name>") public final class Lucent<Name>Module: Module` with `@JS` sync and `@JS(.concurrent) … async throws` members, `@Record` structs, `LucentError: Exception` with `code`
- [x] Kotlin: `definition()` DSL (`Function`, `AsyncFunction … Coroutine`), constructor-parameter `Record` + `@Field` with type defaults, boundary conversions for Byte/Short/unsigned ints; `LucentError` is a plain Exception (code recovered by the proxy from the message) — switch to `CodedException` once verified in the example app
- [x] Bytes as `ExpoModulesCore.ArrayBuffer` / `expo.modules.kotlin.jni.ArrayBuffer`; async functions copy on entry
- [x] Package tree `modules/lucent/` — `expo-module.config.json`, `package.json`, `ios/Lucent.podspec` (sdk-58 template), `android/build.gradle`, `AndroidManifest.xml`, `.gitignore`
- [x] JS proxy via `requireNativeModule('Lucent_<name>')` + generated `.d.ts`; `Uint8Array` ↔ `ArrayBuffer` shim
- [x] Golden tests for every emitted file

### 4. `packages/host-nitro` — react-native-nitro-modules 0.37

- [x] `src/specs/<Name>.nitro.ts` from IR signatures (`interface … extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>`; structs as `interface`; bytes as `ArrayBuffer`)
- [x] `ios/Hybrid<Name>.swift` (`throws`, `Promise.async { }`), `android/.../Hybrid<Name>.kt` (`@Keep @DoNotStrip`, `Promise.async { }`); bodies live in `<Name>Bodies` namespaces with generated `fromNitro`/`toNitro` struct converters, since nitrogen owns boundary types (ints as `number`, Kotlin arrays as `DoubleArray`/`Array<T>`)
- [x] Package tree `.lucent/nitro/` (`lucent-native`): `package.json`, `nitro.json` (current `autolinking.<Name>.ios/android.{language,implementationClassName}` schema), `NitroLucent.podspec`, `android/build.gradle`, `CMakeLists.txt`, `cpp-adapter.cpp`, `LucentPackage.kt`, `react-native.config.js`. The app links it through its own `react-native.config.js` (`dependencies['lucent-native'].root`), not a `file:` dependency, because Bun copies `file:` packages into its store
- [x] `postGenerate` runs `nitrogen` in the package
- [x] JS proxy via `NitroModules.createHybridObject`; `null` ↔ `undefined` for optionals; rethrows `"[CODE] message"` as `LucentError { code, message }` (Kotlin/Swift `LucentError` message is `[CODE] message` on this host — still to wire in the runtime prelude)
- [x] Golden tests for every emitted file

### 5. `packages/cli`

- [x] `lucent build [--host expo|nitro] [--out <dir>] [files…]`, `lucent check`, `lucent watch`, `lucent init`
- [x] Incremental cache `.lucent/cache.json` keyed by `SHA256(compilerVersion + host + source)` storing the IR; prints `✓ cached` / `⚙ compiling`; output files rewritten only when their contents change
- [x] Diagnostics rendered with codeframes, non-zero exit on error
- [x] Tests with a temp dir for cache hit/miss

### 6. `packages/metro`

- [x] `withLucent(config, { host })` sets `transformer.babelTransformerPath` to the bundled `dist/transformer.cjs`; host and upstream transformer reach Metro workers through `LUCENT_HOST` / `LUCENT_UPSTREAM_TRANSFORMER` env
- [x] `scripts/build-packages.ts` (`bun run build:packages`) bundles the Node-loaded entries (Metro transformer, Expo plugin, CLI bin) to CommonJS with `Bun.build`; sources stay the entry for Bun and tsc
- [x] Transformer: for `/\.lucent\.ts$/`, compile in-process, replace `src` with the host's JS proxy, delegate to `@expo/metro-config/babel-transformer` or `@react-native/metro-babel-transformer`
- [x] `getCacheKey()` = upstream key + compiler version + host
- [x] Compile errors surfaced as Metro transform errors with the Lucent codeframe

### 7. `packages/expo` — config plugin

- [x] `app.plugin.js` → `dist/plugin.cjs`; `createRunOncePlugin`; props `{ host?: "expo" | "nitro" }`
- [x] `withDangerousMod` for `ios` and `android`: run the build into `modules/lucent/`, skip when `modRequest.introspect`
- [x] Test invokes the registered dangerous mods directly on a temp project (no prebuild needed)

### 8. `packages/types`

- [x] `@lucent/types` d.ts-only package: branded `int8 … uint64`, `float32`, `float64`

### 9. Example apps and end-to-end verification

- [x] `apps/expo-example` — Expo SDK 58 preview 4, `src/math.lucent.ts` + `src/people.lucent.ts` (add, fibonacci, clamp, async sum, struct round-trip, bytes checksum, throw), `App.tsx` asserts every result and shows ALL OK / FAILURES; `expo prebuild` runs the Lucent plugin (verified: compiles, then cache hits)
- [x] `apps/bare-example` — RN 0.88.0-rc.2 + Nitro 0.37.1, same sources and screen; `bun run lucent` regenerates `.lucent/nitro` and runs nitrogen (verified)
- [x] Expo example on the iOS simulator: ALL OK (10/10 checks: sync, recursion, async, struct with optional, template strings, bytes, error code + message). Note: `export LANG=en_US.UTF-8` is required before any CocoaPods command on this machine
- [x] Bare example (Nitro) on the iOS simulator: ALL OK (same 10 checks) through nitrogen-generated specs and the Lucent Metro transformer with the nitro host
- [x] Expo example on the Android emulator (API 34, arm64): ALL OK. Needs JDK 21 (`JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home`; Gradle 9.4 rejects JDK 27)
- [ ] **TODO** Bare example (Nitro) on the Android emulator. The generated `lucent-native` library configures and compiles, but the Gradle build then fails in `:react-native-nitro-modules:generateCodegenSchemaFromJavaScript` ("Process 'command node' finished with non-zero exit value 1"): RN's codegen script cannot resolve `@react-native/codegen` from Bun's isolated `node_modules` layout. Likely fixes: hoist with `bun install --linker hoisted` for the app, or add `@react-native/codegen` as a direct devDependency of `apps/bare-example`. Run with `JAVA_HOME` pointing at JDK 21 and `-PreactNativeArchitectures=arm64-v8a`
- [ ] Metro cache check: edit a `.lucent.ts` signature, reload without `--clear`

### Later (explicitly out of v1)

Discriminated unions · native classes / shared objects · events · native views ·
thread annotations · platform SDK bindings · capabilities config · stdlib packages.

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
- [ ] `scripts/doctor.ts` — checks bun, node, swiftc, kotlinc, xcodebuild, Android SDK
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
- [ ] Red tests: `test/lowering.test.ts` — golden IR text for `fixtures/*.lucent.ts`
- [ ] `src/ir/` — `IRModule / IRStruct / IRFunction / IRBlock / IRInstr / Terminator`, builder, `printIR` text form
- [ ] `src/lowering/` — typed AST → block IR; structured-region hints so backends can re-emit `if`/`while`; `for…of` → index loop; `&&`/`||` → branches; template literal → concat chain
- [ ] `src/passes/` — constant folding, unreachable-block removal (small, optional)
- [ ] `src/index.ts` — `compile()` wiring all phases; stops after the first phase that produced errors
- [ ] `fixtures/` — `add`, `fibonacci`, `clamp`, `async-sum`, `struct-roundtrip`, `bytes`, `throw`, `diagnostics/*` with golden `.ir.txt` / `.diag.txt`

### 2. `packages/backend-swift`, `packages/backend-kotlin` — IR → source text

Both expose `generate(module: IRModule): GeneratedUnit { structs, functions, imports }` (bodies only, no host wrapper).

- [ ] Red tests: golden `fixtures/<name>.swift` and `.kt`
- [ ] `types.ts` — `NativeType → string` lookup (`Double/Double`, `[T]/List<T>`, `T?/T?`, `[String:T]/Map<String,T>`, `ArrayBuffer/ArrayBuffer`)
- [ ] `emit.ts` — structured re-emission from region hints; temporaries as `let`/`val`; `async throws` / `suspend`; `throw LucentError(code:message:)`
- [ ] Number semantics: `%` as `fmod`/`rem`, string `+` concat, sized-int wrapping ops (`&+` in Swift)
- [ ] `scripts/verify-native.ts` — for each fixture, `swiftc -typecheck` and `kotlinc -nowarn` the generated file plus a tiny `LucentError` / `ArrayBuffer` stub prelude; wired into `bun run verify`

### 3. `packages/host-expo` — Expo SDK 58

- [ ] `Host` interface shared with Nitro: `emitPackage(units) → FileTree`, `emitProxy(module) → { js, dts }`
- [ ] Swift: `@ExpoModule("Lucent_<name>") public final class Lucent<Name>Module: Module` with `@JS` sync and `@JS(.concurrent) … async throws` members, `@Record` structs, `LucentError: Exception` with `code`
- [ ] Kotlin: `definition()` DSL (`Function`, `AsyncFunction … Coroutine`), `Record` + `@Field` with type defaults, `LucentError : CodedException`
- [ ] Bytes as `ExpoModulesCore.ArrayBuffer` / `expo.modules.kotlin.jni.ArrayBuffer`; async functions copy on entry
- [ ] Package tree `modules/lucent/` — `expo-module.config.json`, `package.json`, `ios/Lucent.podspec` (sdk-58 template), `android/build.gradle`, `AndroidManifest.xml`, `.gitignore`
- [ ] JS proxy via `requireNativeModule('Lucent_<name>')` + generated `.d.ts`; `Uint8Array` ↔ `ArrayBuffer` shim
- [ ] Golden tests for every emitted file

### 4. `packages/host-nitro` — react-native-nitro-modules 0.37

- [ ] `src/specs/<Name>.nitro.ts` from IR signatures (`interface … extends HybridObject<{ ios: 'swift'; android: 'kotlin' }>`; structs as `interface`; bytes as `ArrayBuffer`)
- [ ] `ios/Hybrid<Name>.swift` (`throws`, `Promise.async { }`), `android/.../Hybrid<Name>.kt` (`@Keep @DoNotStrip`, `Promise.async { }`)
- [ ] Package tree `.lucent/nitro/` (`lucent-native`): `package.json`, `nitro.json` (current `autolinking.<Name>.ios/android.{language,implementationClassName}` schema), `NitroLucent.podspec`, `android/build.gradle`, `CMakeLists.txt`, `cpp-adapter.cpp`, `LucentPackage.kt`, `react-native.config.js`
- [ ] `postGenerate` runs `nitrogen` in the package
- [ ] JS proxy via `NitroModules.createHybridObject`; rethrows `"[CODE] message"` as `LucentError { code, message }`
- [ ] Golden tests for every emitted file

### 5. `packages/cli`

- [ ] `lucent build [--host expo|nitro] [--out <dir>] [files…]`, `lucent check`, `lucent watch`, `lucent init`
- [ ] Incremental cache `.lucent/cache.json` keyed by `SHA256(source + compilerVersion + host)`; prints `✓ cached` / `⚙ compiling`
- [ ] Diagnostics rendered with codeframes, non-zero exit on error
- [ ] Tests with a temp dir for cache hit/miss

### 6. `packages/metro`

- [ ] `withLucent(config, { host })` sets `transformer.babelTransformerPath` to `@lucent/metro/transformer`
- [ ] Transformer: for `/\.lucent\.ts$/`, compile in-process, replace `src` with the host's JS proxy, delegate to `@expo/metro-config/babel-transformer` or `@react-native/metro-babel-transformer`
- [ ] `getCacheKey()` = upstream key + compiler version + host
- [ ] Compile errors surfaced as Metro transform errors with the Lucent codeframe

### 7. `packages/expo` — config plugin

- [ ] `app.plugin.js` → `build/plugin`; `createRunOncePlugin`; props `{ host?: "expo" | "nitro" }`
- [ ] `withDangerousMod` for `ios` and `android`: run the build into `modules/lucent/`, skip when `modRequest.introspect`
- [ ] Test with `@expo/config-plugins` mod compiler on a temp project

### 8. `packages/types`

- [ ] `@lucent/types` d.ts-only package: branded `int8 … uint64`, `float32`, `float64`

### 9. Example apps and end-to-end verification

- [ ] `apps/expo-example` — Expo SDK 58 beta, `math.lucent.ts` (add, fibonacci, clamp, async sum, struct round-trip, bytes round-trip, throw), screen asserting results
- [ ] `apps/bare-example` — RN 0.88 + Nitro, same screen
- [ ] iOS simulator run of both apps (checked with the simulator inspector)
- [ ] Android emulator run of both apps (fallback: Kotlin compile check, reported as not device-verified)
- [ ] Metro cache check: edit a `.lucent.ts` signature, reload without `--clear`

### Later (explicitly out of v1)

Discriminated unions · native classes / shared objects · events · native views ·
thread annotations · platform SDK bindings · capabilities config · stdlib packages.

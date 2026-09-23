# TODO (`cpp-jsi` rewrite)

Working checklist. `ROADMAP.md` has the milestones; this file tracks the
concrete work. Checked items are implemented and covered by tests.

## Runtime (`packages/runtime/cpp/lucent`)

- [x] `core.h`: `Ref`, `Object`, `Opt<T>` (undefined vs null), `Box<T>` for captured mutable locals
- [x] `jsstring.h`: UTF-16 semantics, Latin-1 storage, in-place `+=`, JS string methods
- [x] `number.h`: ToInt32/ToUint32, bitwise ops, `%`, `**`, shortest `toString`, radix `toString`, `toFixed`/`toPrecision`/`toExponential`, `Number()`, `parseInt`, `parseFloat`, `Math.*` (fdlibm `cbrt`)
- [x] `array.h`: aliasing handle, no holes, callbacks with (value, index, array), stable merge sort, default string sort
- [x] `map.h`: `Map`, `Set`, `Dict` with insertion order, SameValueZero keys, safe mutation during iteration
- [x] `jserror.h`: `Error` objects, `code`, conversion from C++ exceptions
- [x] `bytes.h`: `Uint8Array` (subarray shares the buffer), UTF-8 encode/decode
- [x] `async.h`: `Promise<T>` coroutines (eager, JS ordering), `Promise.all` (arrays and tuples), `delay`
- [x] `scheduler.h`: Lucent thread, global lock, timers, microtasks
- [x] `json.h`: `JSON.stringify`
- [x] `console.h`: os_log / logcat / stdout
- [x] `jsi/convert.h`: JS ↔ C++ conversions with validation and error paths
- [x] `jsi/host.h`: module objects, class prototypes, identity cache, JS callbacks, promise bridging
- [x] `rn/LucentModule`: C++ TurboModule; iOS `+load` registration; Android autolinking header
- [x] Unit tests (195 checks), clean under ASan/UBSan with libstdc++ (Linux) and libc++ (macOS); async e2e clean under TSan
- [x] `Promise.all` rejects on the first rejection and fulfils one tick after the last input (e2e `async`)
- [x] Full Unicode case mapping (generated tables) and platform `localeCompare`, like Hermes
- [x] Exact tie rounding for `toPrecision` / `toExponential` (fuzzed against V8: 0 of 20,000 differ)

## Compiler (`packages/compiler`)

- [x] Program setup: TypeScript checker, `@lucent-lang/core` types, strict + `noUncheckedIndexedAccess`
- [x] Type lowering: structs by shape (recursive types), classes, unions, optionals, tuples, generics
- [x] Diagnostics with stable codes and source locations (vitest suite)
- [x] Narrowing from checker types with explicit conversions
- [x] Closure conversion (capture analysis, boxing, per-iteration `let` bindings, recursive arrows)
- [x] try/catch/finally with completion records; `co_await` outside catch handlers
- [x] async functions, async arrows (captures as coroutine parameters), async methods
- [x] Classes: fields, parameter properties, accessors, statics, `#private`, `this` type, `extends Error`
- [x] Generic functions and classes (C++ templates, type-argument inference by unification)
- [x] Module graph: imports between `.lucent.ts` files, module state, init order, enums
- [x] Left-to-right evaluation of arguments and operands
- [x] `#line` directives
- [x] Interfaces implemented by classes: virtual dispatch, accessors for properties, boundary conversion (e2e `interfaces`)
- [x] Class inheritance: virtual dispatch, `super`, abstract classes, inherited statics and constructors (e2e `inheritance`)
- [x] Generic interfaces and interfaces extending interfaces (e2e `interfaces`)
- [x] Integer inference: int32/uint32/int64 locals and `for` counters (e2e `integers`, `scripts/bench.ts`)
- [ ] Incremental compilation (cache per module)
- [ ] Source maps for native crash symbolication
- [x] Object destructuring in assignments (`({ a, b: c = 1 } = obj)`, defaults in array patterns)
- [x] `Date` (e2e `dates`, runtime tests for daylight-saving rules)
- [x] `JSON.parse` into typed values (e2e `json`)
- [x] Generators and iterables (e2e `generators`)
- [x] `RegExp` on QuickJS libregexp (e2e `regexps`)

## Host & tooling

- [x] Native package writer (`.lucent/native`: runtime, generated C++, podspec, CMake, registration, proxies); only changed files rewritten
- [x] `packages/metro`: transformer swaps `*.lucent.ts` for its proxy; proxies resolve `react-native` from the app
- [x] `packages/cli`: `lucent build`, `lucent check`, `lucent init`
- [x] `packages/expo`: config plugin (build on prebuild, links the package)
- [x] `packages/core`: `delay`, `error`, `errorCode`, `utf8Encode`, `utf8Decode`, `now` (native + JS)
- [x] Verified: RN CLI and Expo autolinking resolve the package as a pure C++ dependency; Android CMake integration builds (host simulation); TurboModule compiles against RN 0.88 headers
- [x] `AbortSignal` / `AbortController`, `delay(ms, signal)`; JS signals abort native work (e2e `abort`)
- [ ] Watch mode (`lucent build --watch`) tied to Metro
- [ ] Publishable build of the TypeScript packages (currently run from source via tsx)

## Tests

- [x] Hermes (Linux) + JSI harness
- [x] Differential e2e tests (12 suites) vs. the same source run as JavaScript
- [x] `scripts/app-check.ts`: the example apps' real Metro bundles + generated C++ in Hermes (bare and Expo)
- [x] Negative suite (diagnostics)
- [x] CI workflow (GitHub Actions: build Hermes, run all suites, iOS/Android builds of the bare example)

## Apps

- [x] `apps/bare-example`: RN 0.88, on-device test screen
- [x] `apps/expo-example`: Expo SDK 58, same screen
- [x] iOS simulator (iPhone 18 Pro, iOS 27, Xcode 27): bare and Expo apps ALL PASSED, reload ×3 without crash
- [x] Android emulator (Pixel 3a, API 34, arm64): bare and Expo apps ALL PASSED, reload ×3 without crash

## Docs

- [x] `README.md`
- [x] `docs/language.md`: supported subset, boundary rules, concurrency, deviations
- [x] `docs/architecture.md`
- [x] `AGENTS.md`

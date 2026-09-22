# TODO (`cpp-jsi` rewrite)

Working checklist. `ROADMAP.md` has the milestones; this file tracks the
concrete work. Checked items are implemented and covered by tests.

## Runtime (`packages/runtime/cpp/lucent`)

- [ ] `core.h` — `Ref`, `Object`, `Opt<T>` (undefined vs null), `Box<T>` for captured mutable locals
- [ ] `string.h` — UTF-16 semantics, Latin-1 storage, in-place `+=`, JS methods (slice, indexOf, padStart, replaceAll, trim, case mapping…)
- [ ] `number.h` — ToInt32/ToUint32, bitwise ops, `%`, `**`, shortest `toString`, radix `toString`, `toFixed`/`toPrecision`/`toExponential`, `Number()`, `parseInt`, `parseFloat`, `Math.*`
- [ ] `array.h` — aliasing handle, no holes, callbacks with (value, index, array), stable merge sort, default string sort
- [ ] `map.h` — `Map`, `Set`, `Dict` with insertion order, SameValueZero keys, safe mutation during iteration
- [ ] `error.h` — `Error` objects, `code`, conversion from C++ exceptions
- [ ] `bytes.h` — `Uint8Array` (views share the buffer), UTF-8 encode/decode helpers
- [ ] `async.h` — `Promise<T>` coroutine type (eager, JS ordering), microtask queue, `Promise.all`, `delay`
- [ ] `scheduler.h` — Lucent thread, global Lucent lock, timers, JS-thread poster interface
- [ ] `json.h` — `JSON.stringify` for Lucent values
- [ ] `console.h` — `console.log` → os_log / logcat / stdout
- [ ] `jsi/convert.h` — JS ↔ C++ conversions with validation and error paths
- [ ] `jsi/host.h` — module objects, class prototypes, identity cache, JS callbacks, promise bridging
- [ ] `rn/LucentModule` — C++ TurboModule, iOS registration (`+load`), Android autolinking header
- [ ] C++ unit tests for the runtime (run under ASan/UBSan)

## Compiler (`packages/compiler`)

- [ ] Program setup: TypeScript checker over `*.lucent.ts`, `@lucent-lang/core` types, strict mode
- [ ] Type lowering: TS types → Lucent types (structs by shape, unions, optionals, generics)
- [ ] Subset validation with stable diagnostic codes (`LUCENT1xxx`)
- [ ] IR: expressions/statements with resolved types and builtin ops
- [ ] Narrowing via checker types + explicit coercions (`unwrap`, `narrow`, `widen`)
- [ ] Closure conversion (capture analysis, boxing)
- [ ] try/finally lowering with completion records
- [ ] async lowering (coroutines; captures passed as coroutine parameters)
- [ ] Classes, getters/setters, static members, private fields
- [ ] Module graph: imports between `.lucent.ts` files, top-level state, init order
- [ ] C++ printer with `#line` directives
- [ ] Boundary descriptors (exports, their JS-facing types)

## Host & tooling

- [ ] `packages/host` — generates the native package: podspec, `ios/*.mm` registration, `android/CMakeLists.txt`, headers, `react-native.config.js`
- [ ] `packages/metro` — replaces `*.lucent.ts` imports with the JS proxy at bundle time
- [ ] `packages/cli` — `lucent build`, `lucent check`, `lucent init`
- [ ] `packages/expo` — config plugin (runs `lucent build` on prebuild, wires react-native.config.js)
- [ ] `packages/core` — user-facing types and helpers (`delay`, …)

## Tests

- [ ] Hermes (Linux) + JSI harness: load generated C++, run JS test files
- [ ] Differential testing: same test JS against native module and against the `.ts` transpiled to JS
- [ ] Conformance suite: numbers, strings, arrays, maps, structs, unions, classes, closures, errors, async, callbacks
- [ ] Negative suite: every diagnostic has a failing fixture
- [ ] ASan + UBSan runs of the whole suite

## Apps

- [ ] `apps/bare-example` — RN 0.88, test screen, `react-native.config.js` pointing at `.lucent/native`
- [ ] `apps/expo-example` — Expo SDK 58 prebuild, same test screen
- [ ] Manual verification on iOS simulator (owner)
- [ ] Manual verification on Android emulator (owner)

## Docs

- [ ] `README.md` — what Lucent is now, quick start
- [ ] `docs/language.md` — supported subset, deviations from JS (no holes, OOB reads, refcounting, one-at-a-time execution)
- [ ] `docs/architecture.md` — pipeline, runtime, host, threading
- [ ] `AGENTS.md` — contributor rules for the new layout

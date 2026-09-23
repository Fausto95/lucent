# Lucent roadmap (`cpp-jsi` rewrite)

Lucent lets you write React Native native modules in a TypeScript subset.
This branch is a from-scratch rewrite: `*.lucent.ts` → C++ → JSI, with no
Swift/Kotlin code generation and no dependency on Nitro or Expo Modules.

```
*.lucent.ts ──TypeScript checker──▶ Lucent IR ──▶ C++ ──▶ JSI (C++ TurboModule)
                                                   │
                                   runtime (lucent::String, Array, Map,
                                   Promise, errors, scheduler, JSI bridge)
```

Status legend: ✅ done · 🚧 in progress · ⏳ next · 🔭 later

---

## M0 — Foundations (this branch)

Goal: the `hash` example runs from C++ on the iOS simulator and the Android
emulator, from both a bare React Native app and an Expo app.

| Area | Item | Status |
|---|---|---|
| Runtime | Value model: number, boolean, `String` (UTF-16, Latin-1 fast path), `Opt<T>`, unions | ✅ |
| Runtime | ECMAScript number semantics (ToInt32, `%`, shortest round-trip `toString`, `toFixed`, `parseInt`…) | ✅ |
| Runtime | `Array<T>`, `Map`, `Set`, `Dict` (Record) with JS aliasing and insertion order | ✅ |
| Runtime | Errors: `Error`/`TypeError`/`RangeError`, `code`, JS ↔ C++ propagation | ✅ |
| Host | Pure C++ TurboModule `Lucent`, autolinked on iOS (global C++ module map) and Android (`cxxModule*` autolinking) | ✅ |
| Host | JSI conversions with argument validation (`hash: argument 'input' must be a string`) | ✅ |
| Compiler | TypeScript checker front end → typed lowering, subset diagnostics | ✅ |
| Compiler | C++ emitter with `#line` mapping to the `.ts` source | ✅ |
| Tooling | `lucent build` CLI, Metro transformer for `*.lucent.ts`, Expo config plugin | ✅ |
| Tests | Hermes-on-Linux harness: every module runs through real JSI and is diffed against the same `.ts` run as plain JS | ✅ |
| Apps | `apps/bare-example` and `apps/expo-example` with an on-device pass/fail screen | ✅ (all green on iOS simulator and Android emulator) |

Exit criteria: the example apps' test screen is all green on an iOS simulator
and an Android emulator.

## M1 — The full language, minus platform SDKs and views

Goal: complex, self-contained modules (parsers, codecs, crypto, data
structures, sync engines) can be written in Lucent.

- ✅ Statements: `if`, loops, `for…of`, `for…in`, `switch`, labels, `try/catch/finally`, `throw`.
- ✅ Expressions: full operator set, `??`, `?.`, `!`, template literals, spread, destructuring.
- ✅ Object types → C++ structs (structural types deduplicated by shape).
- ✅ Discriminated unions and `typeof` / discriminant / `instanceof` narrowing (driven by the TS checker's narrowed types).
- ✅ Classes: fields, constructors, methods, accessors, `static`, `private`; exported classes become JS objects with stable identity.
- ✅ Closures with shared mutable captures (boxing of captured, mutated locals).
- ✅ Unconstrained generics (functions and classes → C++ templates).
- ✅ `async`/`await` on C++20 coroutines, `Promise.all`, `delay()`; exported async functions run off the JS thread.
- ✅ JS callbacks as parameters (sync on the JS thread, async-posted elsewhere; `await`able when they return a Promise).
- ✅ Built-ins: `Math`, `Number`, `String`, `Array`, `Map`, `Set`, `Object.keys/values/entries`, `JSON.stringify`, `console`, `Uint8Array`.
- ✅ Concurrency model: Lucent code runs one-at-a-time (like JS) under one lock; async work runs on a Lucent thread; no data races by construction.
- ✅ `AbortSignal` cancellation for exported async functions.
- ✅ `class X extends Error`.
- ✅ Interfaces implemented by classes (virtual dispatch).
- ✅ Class inheritance.
- ⏳ Generic interfaces; interfaces extending interfaces.
- ✅ Integer inference (`int32`/`uint32`/`int64` locals and loop counters).

Exit criteria: conformance suite (differential tests vs. plain JS) covering
every item above passes under ASan/UBSan on Linux and on both simulators.

## M2 — Platform APIs (import AVFoundation, android.*)

Design: [`docs/m2-platform-bindings.md`](docs/m2-platform-bindings.md) (proposal, awaiting decisions).

Goal: `import { AVCaptureDevice } from "lucent:ios/AVFoundation"` and
`import { BatteryManager } from "lucent:android/android.os"` just work.

- 🔭 iOS: generate typed bindings from SDK headers with clang (`-ast-dump=json`); emit ObjC++ calls. Nullability, generics, blocks, `NS_SWIFT_UI_ACTOR`/main-thread annotations.
- 🔭 iOS: Swift-only APIs through generated Swift shims (`@_cdecl` / Swift ↔ C++ interop).
- 🔭 Android: generate bindings from `android.jar` / AAR class files; emit JNI with cached class/method IDs.
- 🔭 Android: Kotlin-specific surface (suspend functions, default arguments) via generated Kotlin shims.
- 🔭 Delegates and protocols: Lucent classes implementing ObjC protocols / Java interfaces (generated ObjC classes and Java proxies forwarding to C++).
- 🔭 Thread affinity in the type system (main-thread-only APIs require `async`).
- 🔭 Resource lifetimes (camera sessions, file handles) with explicit close.

## M3 — Views

- 🔭 SwiftUI / UIKit and Compose / Android views from Lucent components (Fabric).

## M4 — Production readiness

- 🔭 npm publishing of `@lucent-lang/*`, fresh-install smoke test.
- 🔭 Incremental builds and caching; watch mode tied to Metro.
- 🔭 Source maps for native crashes (symbolicated back to `.lucent.ts`).
- 🔭 Language server (diagnostics for the Lucent subset in the editor).
- 🔭 Performance budgets and benchmarks vs. hand-written C++/Swift/Kotlin.

## Non-goals (for now)

- Running arbitrary JavaScript on the native side (no embedded engine).
- Unrestricted inheritance, reflection, `eval`, prototypes.
- Cycle collection (objects are reference counted; see docs).

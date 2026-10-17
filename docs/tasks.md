# Lucent tasks

The open work, task by task, grouped by gate. [ROADMAP.md](../ROADMAP.md)
says why and in what order. [parity.md](parity.md) is the capability
matrix against Nitro and Expo Modules that the gates come from. Decisions
are in [decisions/](decisions/), and finished work is in
[CHANGELOG.md](../packages/lucent/CHANGELOG.md), by release.

Tasks live here rather than in GitHub issues, so the commit that does the
work updates its task. A commit that finishes, changes or adds a task
updates its entry and the table below in the same commit. A new task takes
the next free id in its gate's range and never reuses one. The ranges are
T100–T119 for module parity, T120–T129 for view parity, T130–T139 for
execution modes, T140–T149 for distribution and T150–T159 for the
production candidate.

The plan was rewritten from scratch on 2026-10-12
([decision 0080](decisions/0080-the-plan-is-rewritten-for-parity-with-nitro-and-expo-modules.md)).
Ids below T100, and `TA` ids, belong to the earlier plan: read them in
this file at commit `1f72821d`. [Former task ids](#former-task-ids) says
what became of each one that is still linked or was still open.

## Status

| Task                     | Title                                                      | State                                                                |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| **Module parity**        |                                                            |                                                                      |
| [T100](#t100)            | Typed arrays and `DataView`                                | done (2026-10-13)                                                    |
| [T101](#t101)            | Keep `null` apart from `undefined` everywhere              | done (2026-10-13)                                                    |
| [T102](#t102)            | Recursive union types, for JSON-shaped values              | done (2026-10-14)                                                    |
| [T103](#t103)            | Promise chaining, combinators and JavaScript's await order | done (2026-10-13)                                                    |
| [T104](#t104)            | Timers and `queueMicrotask`                                | done (2026-10-13)                                                    |
| [T105](#t105)            | Web APIs that shared code uses                             | done (2026-10-14)                                                    |
| [T106](#t106)            | Language gaps module code meets                            | done (2026-10-15)                                                    |
| [T107](#t107)            | Native objects: memory pressure and native handles         | done (2026-10-13)                                                    |
| [T108](#t108)            | Platform memory as JavaScript bytes, without copying       | done (2026-10-13)                                                    |
| [T109](#t109)            | Executors for platform callbacks                           | done (2026-10-13)                                                    |
| [T110](#t110)            | App-delegate and Activity events                           | done (2026-10-14)                                                    |
| [T111](#t111)            | The app's own native needs and options                     | done (2026-10-15)                                                    |
| [T112](#t112)            | SDK shapes Lucent still refuses                            | in progress                                                          |
| [T113](#t113)            | Classes that extend `EventEmitter`                         | done (2026-10-15)                                                    |
| [T114](#t114)            | Native code that calls Lucent modules                      | in progress (#315 to #322)                                           |
| [T115](#t115)            | Native configuration packages can't declare yet            | in progress (#299, #300, #301, #302)                                 |
| **View parity**          |                                                            |                                                                      |
| [T120](#t120)            | Instances of exported classes as view props                | done (2026-10-13)                                                    |
| [T121](#t121)            | React Native's view props, refs and view libraries         | done (2026-10-14)                                                    |
| [T122](#t122)            | UIKit components with a view-controller root               | in progress (#324, #325)                                             |
| [T123](#t123)            | Native objects and helpers in SwiftUI and Compose bodies   | in progress (#328 to #339 merged, #340, #341)                        |
| [T124](#t124)            | A component's ref as a module function's argument          | in progress (#326 merged)                                            |
| [T125](#t125)            | Android views made after setup keep the Activity's context | in progress (#327)                                                   |
| **Execution modes**      |                                                            |                                                                      |
| [T130](#t130)            | A native root: module code with no JavaScript runtime      | done (2026-10-13)                                                    |
| [T131](#t131)            | Android classes the OS instantiates, written in Lucent     | done (2026-10-14)                                                    |
| [T132](#t132)            | iOS background execution                                   | done (2026-10-14); relaunches are T137                               |
| [T133](#t133)            | iOS app extensions and widgets                             | in progress (#345 to #356): decided (0124)                           |
| [T134](#t134)            | Calls from worklet runtimes                                | in progress (#342–#344): a device run remains                        |
| [T135](#t135)            | JavaScript tasks from background entry points              | blocked: a decision on whether Lucent offers it                      |
| [T136](#t136)            | App Intents, Live Activities and Android widget bodies     | waiting; needs T133                                                  |
| [T137](#t137)            | Relaunches for background URL sessions and silent pushes   | ready                                                                |
| **Distribution**         |                                                            |                                                                      |
| [T140](#t140)            | A window of stable React Native and Expo releases, run     | in progress (#190 to #204, #363 merged)                              |
| [T141](#t141)            | Builds from Xcode, and a package's pods in Expo apps       | done (2026-10-14)                                                    |
| [T142](#t142)            | C++ libraries, extension callbacks and borrowed bytes      | in progress (#357 to #375): all but lucent-mmkv, which needs devices |
| [T143](#t143)            | Typed Kotlin and Java sources in packages                  | done (2026-10-16)                                                    |
| [T144](#t144)            | A web target for shared modules                            | done (2026-10-17)                                                    |
| [T145](#t145)            | The package distribution matrix                            | done (2026-10-17)                                                    |
| **Production candidate** |                                                            |                                                                      |
| [T150](#t150)            | Reference ports for each parity row                        | waiting; each port names its needs                                   |
| [T151](#t151)            | Lifetime, concurrency and Fabric stress validation         | in progress (#385): host stress runs                                 |
| [T152](#t152)            | The no-catalog audit                                       | done (2026-10-17)                                                    |
| [T153](#t153)            | Benchmarks against Nitro and Expo Modules                  | ready                                                                |
| [T154](#t154)            | Guides for every parity row, and migration guides          | waiting; needs T150                                                  |
| [T155](#t155)            | The production-candidate gate                              | waiting; needs every other task but T135                             |
| [T156](#t156)            | CI runs what the docs say it runs                          | in progress (#387, #388)                                             |
| [T157](#t157)            | Small fixes the docs rewrite found                         | ready                                                                |

## Gates

A gate closes when every task in its range is done and its check passes on
the integrated result. Gates share some dependencies, which each task's
Needs lists; the production candidate needs the other four.

| Gate                 | Tasks     | Closes when                                                                                                                          |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Module parity        | T100–T115 | A module offers the values, objects, events, threads, app events and native configuration a Nitro or Expo module offers              |
| View parity          | T120–T125 | A component takes props of any type and React Native's view props, has a controller root, and shows native objects in toolkit bodies |
| Execution modes      | T130–T137 | Lucent code runs with no JavaScript, in background tasks, services, extensions, widgets and worklet runtimes                         |
| Distribution         | T140–T145 | Fresh apps on each supported release build and run, and packages build like any library, with C++, their own Kotlin and the web      |
| Production candidate | T150–T157 | Ports prove each row, stress and budgets pass, CI runs what it claims, the docs cover every row, and the integration run is green    |

## Requirements

These hold for every task. A task is not done by weakening one of them.

| Requirement          | What it means                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No curated catalog   | APIs come from the installed SDKs and resolved dependencies. No list of SDKs, APIs, views or class names decides behavior. A small fixed platform surface (JSI, Fabric, JNI, ARC, app lifecycle) is allowed and named in the audit. |
| Mechanisms in core   | Core provides mechanisms: entry points, executors, buffers, lifecycle events. An API such as a background-task scheduler or a notifications module is a Lucent package built on them, never a core special case.                    |
| JavaScript semantics | [semantics.md](semantics.md) is the contract. Unsupported code fails with an actionable `LUCENT` diagnostic, never with invalid native code or a compiler crash.                                                                    |
| Thread ownership     | JSI values stay on their runtime's thread; other threads hold `Host` ids. The main thread never queues behind module jobs: it waits at most for the job running now.                                                                |
| Copy by default      | Arrays, objects and bytes copy at the boundary. Every exception (a move, a loan, an adoption) is explicit and documented.                                                                                                           |
| Generated code       | Generated through `packages/codegen`, built with `-ffp-contract=off`, with explicit evaluation order, coroutine frames that own their captures, and JSI objects on the JS thread.                                                   |
| Repository rules     | [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md): differential e2e cases, runtime sanitizers, synchronized examples, changesets, docs in the same commit.                                                        |
| Contracts first      | An interface several parts implement is written into [contracts.md](design/contracts.md) before they implement it. A decision changes the plan, never a quiet edit.                                                                 |
| Honest evidence      | Evidence levels are kept apart: code, host, and simulator or emulator. A check that could not run is reported as not run, never as a pass.                                                                                          |

## How to read a task

Each task has a stable anchor (`docs/tasks.md#t100`), a one-sentence goal,
then:

- **Status:** `ready` (every dependency is done), `waiting` (on the tasks
  in Needs), `blocked` (on a decision), `in progress` (work is merged or
  a branch exists) or `done (date)` with its PRs.
- **Area:** compiler, bindings, runtime, views, the iOS or Android host,
  tooling, or verification.
- **Needs:** the tasks it depends on. Dependencies are the only ordering.
- **Verify:** the [validation profiles](#validation) it must pass.
- **Where:** the code it changes. `lib/sdk` is `packages/compiler/lib/sdk`,
  the source of the `lucent:*` declarations.

The checklist is the acceptance criteria, and **Done when** closes the
task. A task is checked off only when its criteria pass on the integrated
result.

## Module parity

<a id="t100"></a>

### T100: Typed arrays and `DataView`

**Goal:** Every JavaScript typed array and `DataView` works in Lucent code
and crosses the boundary, so audio, sensor and model modules pass samples
as Expo modules do.

- **Status:** done (2026-10-13): #249, #251 and #252.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V1, V2, V3, V7.
- **Where:** `runtime/cpp/lucent` (`bytes.h` and a typed-array header),
  `emit/builtins.ts`, `jsi/convert.*`, `lib/sdk`.

The runtime has them all (#249): `lucent/bytes.h`'s `TypedArray<Kind>`,
`Uint8Array` among them, and `DataView`. The compiler takes them, and the
boundary carries them (#251). A `NativeBuffer`'s borrows lend its bytes as
any kind's elements (#252,
[0099](decisions/0099-a-buffer-is-borrowed-as-typed-elements-through-spans.md)).

- [x] `Int8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`,
      `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`,
      `BigInt64Array` and `BigUint64Array`, with the methods `Uint8Array`
      has, as views over one `ArrayBuffer` at any byte offset, with
      JavaScript's conversion and clamping on write.
- [x] `DataView`, every getter and setter, both byte orders.
- [x] The `%TypedArray%` methods `Uint8Array` still refuses (`at`,
      `filter`, `sort`, `lastIndexOf` and the rest), for every kind, and
      `ArrayBuffer.isView`.
- [x] The boundary treats them as `Uint8Array`: copied by default, lent to
      a synchronous export that only reads, moved on return when nothing
      else holds the buffer.
- [x] A typed view of a `NativeBuffer`'s bytes inside `withRead` and
      `withWrite`: `withReadAs` and `withWriteAs` (case `buffer-views`).
- [x] e2e: `typed-arrays`, `data-view`; semantics and the website's
      language page list them.

**Done when:** the cases pass natively and as JavaScript, and no typed
array is listed as refused.

<a id="t101"></a>

### T101: Keep `null` apart from `undefined` everywhere

**Goal:** A value typed `T | undefined` never holds `null`, and one typed
`T | null` never holds `undefined`, wherever it comes from, as Nitro's
optionals and Expo's `ValueOrUndefined` guarantee.

- **Status:** done (2026-10-13).
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `jsi/convert.h`, `core.h` (`Opt`), `emit/bindings.ts`.

`Opt` kept the two apart inside containers, but the checks took the wrong
one. Now the compiler spells such an optional `OrUndefined` or `OrNull`
wherever it sits, and each refuses the other absent value.

- [x] The boundary rejects the wrong one of the two in each container,
      callback result and promise value with a `TypeError` naming its
      path, as it does for an argument.
- [x] e2e: `null-undefined-nested`, covering each container both ways.

**Done when:** the known gap is gone from `apps/website/src/docs/language.ts`
and [limitations.md](limitations.md).

<a id="t102"></a>

### T102: Recursive union types, for JSON-shaped values

**Goal:** A recursive union alias compiles and crosses, so a module takes
and returns untyped data, as Nitro's `AnyMap` and Expo's dictionaries do:

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
```

- **Status:** done (2026-10-14): #254 and #255.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `types.ts`, `emit/`, `jsi/convert.h`.

The compiler overflowed its stack on that alias (`RangeError: Maximum
call stack size exceeded`). #254 refused it with LUCENT2002; #255 makes it
a type of its own, `lucent_app::J_Json`, which the containers inside it
hold.

- [x] First, a regression test: the alias gives a `LUCENT` diagnostic, not
      a crash (`diagnostics.test.ts`, #254).
- [x] A recursive union lowers to a variant that holds its recursive
      members by reference. `typeof` and `Array.isArray` narrow it.
- [x] It crosses both ways at any depth, under the stack check, and
      `JSON.parse(text) as Json` fills it.
- [x] The guide shows platform dictionaries (`NSDictionary`, `Bundle`,
      `JSONObject`) reaching it through their JSON serializers.
- [x] e2e: `json-values`.

**Done when:** the alias above compiles, crosses and round-trips through
`JSON.parse` and `JSON.stringify`, natively and as JavaScript.

<a id="t103"></a>

### T103: Promise chaining, combinators and JavaScript's await order

**Goal:** Promise code from ordinary TypeScript modules compiles, and
settles in the order JavaScript settles it.

- **Status:** done (2026-10-13).
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `async.h`, `ir/lower.ts`, `emit/builtins.ts`, `lib/sdk`.

Before, `then`, `catch` and `finally` gave LUCENT1003 ("use await"), and
so did `Promise.race` and `Promise.any`. `Promise.allSettled` failed on
`PromiseRejectedResult` (LUCENT2002). `await` of a value that isn't a
promise didn't suspend, and `return p` in an async function was lowered
as `return await p`. Now `async.h` settles each in JavaScript's
microtasks, and an async function adopts a promise it returns
([decision 0101](decisions/0101-async-functions-adopt-returned-promises.md)).

- [x] `then`, `catch` and `finally`, with JavaScript's microtask order.
- [x] `Promise.race`, `Promise.any` (with `AggregateError`) and
      `Promise.allSettled` (with `PromiseSettledResult`).
- [x] `await` of any value suspends for a microtask, and `return p`
      settles when JavaScript's does.
- [x] e2e: `promise-chains`, `promise-combinators`, `await-order`, which
      compare the order of settled callbacks with JavaScript's.

**Done when:** none of them is refused, and the order cases pass natively
and as JavaScript.

<a id="t104"></a>

### T104: Timers and `queueMicrotask`

**Goal:** `setTimeout`, `setInterval` and `queueMicrotask` work in module
code, on the context that calls them.

- **Status:** done (2026-10-13).
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `execution.h`, `hooks.h`, `packages/compiler/lib/globals.d.ts`.

Before, only `delay(ms, signal)` from `lucent:core` existed. Now the
runtime's `timers.h` runs them, and `globals.d.ts` declares them.

- [x] `setTimeout`, `clearTimeout`, `setInterval` and `clearInterval` on
      the calling context (a module's actor, the main thread, an
      executor), with HTML's ordering rules where JavaScript states them.
- [x] `queueMicrotask` on the calling context's microtask queue.
- [x] Timers a module started are cleared at teardown, as `onDestroy`
      hooks run.
- [x] e2e: `timers` (microtasks among them); `execution_test.cpp`
      checks their context and a scope's disposal, and `actor_test.cpp`
      that a call's microtasks run before a job queued during it.

**Done when:** the cases pass natively and as JavaScript.

<a id="t105"></a>

### T105: Web APIs that shared code uses

**Goal:** Code shared between platforms encodes text, base64 and URLs, and
makes random values, without per-platform calls.

- **Status:** done (2026-10-14; #286–#289).
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `runtime/cpp/lucent`, `runtime/cpp/third_party`,
  `packages/compiler/lib/globals.d.ts`.

- [x] `TextEncoder` and `TextDecoder` (UTF-8, `fatal`, `ignoreBOM`,
      `stream`), by the Encoding standard (`runtime/cpp/lucent/text.h`,
      `emit/web.ts`). Another encoding's label is refused.
- [x] `atob` and `btoa`, by HTML's forgiving base64, with Node's errors.
- [x] `URL` and `URLSearchParams`, by WHATWG's parser: Ada, vendored in
      `third_party/ada` with its licenses, carried only by programs that
      make a URL (decision 0107).
- [x] `crypto.getRandomValues` and `crypto.randomUUID`, from the
      platform's secure generator (`runtime/cpp/lucent/entropy.h`).
- [x] Each is exact or refused: an option it doesn't support is a
      diagnostic.
- [x] e2e: `text-encoding`, `base64`, `urls`, `random-values`.

**Done when:** the cases pass natively and as JavaScript.

<a id="t106"></a>

### T106: Language gaps module code meets

**Goal:** Lift the refusals that ordinary module code meets most.

- **Status:** done (2026-10-15): object rest (#278), spread from tuples
  (#279), an error's cause (#280), `JSON.stringify`'s keys and space
  (#281), `flat` and `copyWithin` (#282), ES2025's set methods (#283),
  `for await` (#284), async generators (#291), platform files' classes
  (#292), the temporal dead zone (#293), generators' values (#294).
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `ir/lower.ts`, `emit/`.

- [x] Object rest in destructuring, from objects and records, in
      declarations, parameters, `for…of` and assignments (#278).
- [x] Spread arguments from tuples, into fixed parameters, rest
      parameters, array literals and built-ins (#279). Spreading arrays
      into rest parameters worked already; TypeScript spreads nothing else
      into fixed parameters.
- [x] `new Error(message, { cause })` and an error's `cause`, which crosses
      to JavaScript and back: an `Error`, as a caught value is (#280).
- [x] `JSON.stringify` with a replacer that lists keys, and an indent
      (#281). A replacer function sees each value as `any`, so it stays
      refused.
- [x] `Array.prototype.flat` and `copyWithin` (#282).
- [x] The ES2025 `Set` methods (`union`, `intersection`, `difference`,
      `symmetricDifference`, `isSubsetOf`, `isSupersetOf`,
      `isDisjointFrom`), with a `Set` or a `Map` as the other (#283).
- [x] `for await…of` over a `Channel` and over iterables, each element
      awaited (#284).
- [x] Async generators, and `for await…of` over them (#291): an
      `AsyncIter<T>` coroutine that awaits and yields, queuing the requests
      made while it runs; a loop left early awaits its `return()`.
- [x] `yield` as a value, a generator's `return v` and `throw()` (#294): a
      `Generator<T, TReturn, TNext>` is a `lucent::Gen`, and `yield*` hands
      its requests to the iterator it delegates to.
- [x] A `let` or `const` used before its declaration runs throws
      `ReferenceError` (#293): a local that a closure made before it
      captures is a box in its dead zone until declared; a module
      variable that an earlier initializer's call reaches has a flag
      `init()` sets.
- [x] A class declared in the declaration file of platform files
      (`export declare class`), with each platform file implementing it
      (#292): shared code and JavaScript use the platform's class; a
      target without the platform's file gets a class whose every member
      throws.
- [x] An e2e case for each. Platform files' classes, whose code needs a
      platform, run in `platform-classes.test.ts` on the JVM host and on
      the example apps' Platform screen.

**Done when:** each item passes natively and as JavaScript, and the website
lists none of them as refused.

<a id="t107"></a>

### T107: Native objects: memory pressure and native handles

**Goal:** An exported class tells JavaScript's garbage collector how much
native memory an instance holds, and native pointers reach other native
code as typed handles.

- **Status:** done (2026-10-13): `NativeHandle`'s type, its JSI
  conversion and the `opaque-values` and `native-handles` cases (#175,
  #180, #183, as T73); memory pressure (#211,
  [0084](decisions/0084-a-class-states-its-native-size-by-implementing-nativesized.md)),
  the platform makers (#212), and the reload cases and Interop section
  (#213).
- **Area:** runtime, bindings.
- **Needs:** nothing.
- **Verify:** V1, V2, V3, V4.
- **Where:** `handle.h`, `jsi/convert.cpp`, `lib/sdk/ios.d.ts`,
  `lib/sdk/android.d.ts`.

A moved `ArrayBuffer`, a `NativeBuffer` and a `NativeSized` instance
report their size to the collector.

- [x] Memory pressure: a decision on how a class states its native size
      (a member it declares, read when an instance crosses and when it
      changes), then `setExternalMemoryPressure` on its JavaScript object.
      `NativeBuffer` reports its size the same way.
- [x] Platform makers for `NativeHandle`: `retainedHandle(obj)` in
      lucent:ios (a +1 retain, `CFRetain` for CF types), and one from a
      `HardwareBuffer` or a direct `ByteBuffer` in lucent:android.
      `release()` once, from either side. The JNI host runs the
      `ByteBuffer` one and the macOS host `retainedHandle`; the
      `HardwareBuffer` one compiles for Android, with no host to run it.
- [x] The `opaque-values` and `native-handles` cases extended to a reload
      and to the platform makers. The e2e host replaces its host; the
      makers, which need a platform, run in `platform-handles.test.ts`
      on the JNI and macOS hosts.
- [x] Semantics: an "Interop" section.

**Done when:** a host test shows the collector seeing an instance's native
size, and the extended cases pass.

<a id="t108"></a>

### T108: Platform memory as JavaScript bytes, without copying

**Goal:** A camera frame, an image or a file's bytes reach JavaScript as an
`ArrayBuffer` without a copy, on both platforms.

- **Status:** done (2026-10-13): returned buffers move, a synchronous
  export reads JavaScript's bytes in place, and Android adopts a direct
  `ByteBuffer` (#163, #165, #167, #168, as T72). Frames are adopted on both
  platforms, read-only unless asked (#216,
  [0086](decisions/0086-platform-memory-is-adopted-read-only-unless-asked.md)).
  The emulator's device run adopts an `ImageReader`'s frames with no copy
  (#225, #230).
- **Area:** runtime, bindings.
- **Needs:** nothing.
- **Verify:** V1, V3, V4, V5, V7.
- **Where:** `buffer.h`, `platform/`, `lib/sdk/ios.d.ts`,
  `lib/sdk/android.d.ts`.

- [x] ~~lucent:ios adopts an `NSData`'s bytes as an `ArrayBuffer`, retained
      until released.~~ Decided against (0086): Swift's `Data` and
      `NSData` cross as `Uint8Array` copies, so Lucent never holds one,
      and their bytes may be shared or mapped read-only.
- [x] lucent:ios adopts a `CVPixelBuffer` plane: its base address is
      locked for the buffer's life, read-only unless asked, then unlocked
      and released once. `withPixelBytes` stays as the copying form.
- [x] lucent:android adopts a `HardwareBuffer` (API 26 and later, behind
      `available`), through the NDK's `AHardwareBuffer`.
- [x] Semantics: the boundary's copy rule names each exception. The
      C-BUFFER contract records the adoptions.

**Done when:** each adoption has a host test, and a simulator or emulator
run shows no copy of the payload (the buffer's stats count none).

<a id="t109"></a>

### T109: Executors for platform callbacks

**Goal:** A frame delegate, a sensor listener or a socket callback runs on
a serial executor of its own, never queued behind JavaScript calls that
hold its module's actor.

- **Status:** done (2026-10-13): `Channel` with its three policies and
  `subscribe`, and the runtime's `ExecutorContext`, are merged (#181,
  #182, #187, #197, as T74). So are `executor(label)` and `on(exec, f)`
  for functions (#206), objects with `on(exec, new C(…))` (#207), and
  events emitted from executor code (#208), trace (#209) and the host
  bench (#210: `executor_test.cpp`, p99 under 2 ms while the actor is
  held 500 ms, no actor waits), and an `on()` kept in a `const` (#215).
  The device runs' Platform screen checks frames through an executor,
  and passes on the simulator and the emulator (#225, 2026-10-13): done.
  Decided as
  [0078](decisions/0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md),
  [0081](decisions/0081-functions-on-an-executor-share-only-constants-and-channels.md),
  [0082](decisions/0082-objects-go-on-an-executor-where-they-are-made.md),
  [0083](decisions/0083-code-on-an-executor-emits-through-emitters-it-holds.md)
  and [0085](decisions/0085-a-const-keeps-one-platform-object-of-an-executor-callback.md).
- **Area:** compiler, runtime, bindings.
- **Needs:** nothing.
- **Verify:** V1, V2, V3, V4, V7.
- **Where:** `lib/sdk/thread.d.ts`, `execution.h`, `emit/`, `analysis/`.

A function or an object handed to the platform with `on(exec, …)` runs
on the executor without its module's lock. Any other delegate's
callbacks still take it, on `serialQueue(label)`'s queue or any other.

- [x] `executor(label)` from `lucent:thread`: a serial dispatch queue on
      iOS and a single-thread `Executor` on Android, which platform APIs
      that take one take as it is.
- [x] `on(exec, f)` puts a function literal on it where it is handed to
      the platform (a block, a Java functional interface, a Kotlin
      function). The glue enters the executor's context directly.
- [x] `on(exec, new C(…))` does the same for an object made there: its
      class's methods enter the executor (0082).
- [x] A function on an executor kept in a `const` is one platform object
      wherever it is handed over, so a listener added with it can be
      removed with it. So is an object
      ([0085](decisions/0085-a-const-keeps-one-platform-object-of-an-executor-callback.md)).
- [x] The compiler checks executor functions as it checks a compute task,
      but allows native code of unknown thread. Module state, main-thread
      code, promises and awaits are refused with the cause path, and
      captures are constants, channels and executors (0081).
- [x] Members only executor code touches are the executor's: an executor
      class keeps `this` to itself, so all of its are (0082).
- [x] Executors produce into channels, and post `EventEmitter` events to
      JavaScript (0083). The guide says which to use for what
      ([Handle frequent callbacks on an executor](../apps/website/src/content/docs/docs/guides/handle-callbacks-on-an-executor.mdx)).
- [x] Trace: each channel's waits, depth and drops, and an executor's
      spans beside its actor's.
- [x] Bench (host): synthetic 1080p frames at 60 Hz through an executor
      into a `latest` channel, while a 500 ms synchronous JavaScript call
      holds the module's actor. The executor thread waits on no actor,
      drops are counted, and the p99 handler latency is reported.
- [x] Semantics: the concurrency model gains executors and channels.

**Done when:** the bench shows no actor wait on the executor thread, and
frames reach a channel through an executor in the device runs' Platform
screen. On the emulator they are an `ImageReader`'s, adopted uncopied. The
simulator has no camera, so there an operation queue on the executor's
queue makes them.

<a id="t110"></a>

### T110: App-delegate and Activity events

**Goal:** Module code receives what only the app delegate and the Activity
receive, through the subscriber
[0076](decisions/0076-an-app-delegate-and-activity-subscriber.md)
describes.

- **Status:** done (2026-10-14): iOS's events reach `onAppEvent` typed, through
  `LucentAppDelegate` (#217), which `lucent init` has a bare app's
  delegates call, `lucent doctor` checks and `lucent build` names when
  missing (#218, #220), and an Expo app's `AppDelegate` calls through
  Lucent's subscriber (#219). Relaunch reasons and the notification
  delegate (#223, #224), Android's Activity events, keys and main
  Activity attributes (#221, #222, #226, #227) are in. The device runs'
  Platform screen checks them, and passes on the simulator and the
  emulator in both example apps (#225, 2026-10-13; the Expo example's,
  #261, 2026-10-14).
- **Area:** iOS and Android hosts, runtime, tooling.
- **Needs:** nothing.
- **Verify:** V1, V3, V4, V5, V6.
- **Where:** `platform/ios_ui.mm`, `lifecycle.h`,
  `platform/android_activity.cpp`, `runtime/native`,
  `cli/commands/init.ts`, `app.plugin.js`.

- [x] iOS, through `onAppEvent`, typed: `openURL` (url, options),
      `userActivity` (type, url, payload), `pushToken` (`Uint8Array`) and
      its failure, `remoteNotification` (payload; the handler answers the
      fetch result through a promise with a deadline, and answers from
      several modules merge as Expo merges them), `backgroundFetch`,
      `backgroundURLSession` (identifier, and a completion the module
      calls), `shortcutItem` and `supportedInterfaceOrientations`.
- [x] The URL, user activity, shortcut or relaunch reason (location,
      Bluetooth, a notification) that launched the app is kept until the
      first subscriber takes it: URLs, user activities, shortcuts and the
      push token (#217), and relaunch reasons through
      `onAppEvent("relaunched")` (#223).
- [x] `UNUserNotificationCenter`'s delegate (`willPresent`,
      `didReceive`) shared between modules, as Expo's notifications
      module shares it: `onAppEvent("willPresentNotification")` and
      `onAppEvent("notificationResponse")`, Lucent's delegate in front of
      the app's
      ([0087](decisions/0087-lucent-stands-in-front-of-the-apps-notification-delegate.md),
      #224).
- [x] Android: first, which events module code already reaches through
      androidx's listeners on the current `ComponentActivity`
      (`onBackPressedDispatcher`, `addOnConfigurationChangedListener`,
      `addOnNewIntentListener`, `addOnUserLeaveHintListener`), tested on
      the emulator. The subscriber covers the rest. Back handling goes
      through the dispatcher, since Android 16 doesn't call
      `onBackPressed` for apps targeting API 36. `onActivityEvent` reports
      all four through those listeners, back presses answered on the main
      thread (#221). A `ReactActivity` doesn't pass new intents on to
      AndroidX while React runs, so they come from its React context
      instead. Key presses the app didn't handle reach
      `onActivityEvent("keyDown")` and `"keyUp"` through the Activities'
      wrapped window callbacks
      ([0088](decisions/0088-android-key-presses-come-from-a-wrapped-window-callback.md),
      #226). The emulator's device run passes (2026-10-13).
- [x] In an Expo app, an `ExpoAppDelegateSubscriber` and a
      `ReactActivityLifecycleListener` the build declares. In a bare app,
      `lucent init` adds one forwarding line per delegate method,
      `lucent doctor` checks them, and `lucent build` names a missing one.
      `lucent init` and `doctor` do (#218), and the native package is a
      module Swift imports (`import LucentNative`). On iOS, Expo's
      subscribers include Lucent's, registered at load (#219), and
      `lucent build` names a missing call (#220). On Android neither app
      needs anything: AndroidX's listeners, the React context and the
      window callback reach every Activity
      ([0088](decisions/0088-android-key-presses-come-from-a-wrapped-window-callback.md)).
- [x] `lucent.json` `android.mainActivity` attributes
      (`supportsPictureInPicture`, `configChanges`, `launchMode`): a bare
      app's `lucent build` names what its manifest lacks, and the Expo
      plugin writes them
      ([0089](decisions/0089-main-activity-attributes-are-named-or-written-as-plist-entries-are.md),
      #227).
- [x] Tests: `lifecycle_test.cpp` merges answers. The example apps open a
      deep link and read a push token in their device-check runs on the
      simulator and emulator (a fake registration exercises the token
      path). The bare example's Platform screen, which the device runs
      open after the Tests screen, opens a deep link to the app, registers
      for a push token (an unsigned simulator build answers why it has
      none), and presses back and rotates on Android (#225), and passes
      on the simulator and the emulator (2026-10-13). So does the Expo
      example's, a Release build made by `expo prebuild` and `pod install`
      as an Expo app's is (#261, 2026-10-14).

**Done when:** both example apps receive each event in their device-check
runs.

<a id="t111"></a>

### T111: The app's own native needs and options

**Goal:** Modules in the app itself declare their native needs, as a
package's do, and an app sets the options a package asks for.

- **Status:** done (2026-10-15): the app's own `lucent.json` (#296),
  options the app sets (#297), the smoke install's (#298).
- **Area:** compiler, tooling.
- **Needs:** nothing.
- **Verify:** V1, V5, V6.
- **Where:** `package-config.ts`, `packages.ts`, `app.plugin.js`.

Only dependency packages' `lucent.json` was read (`lucentPackages` visits
dependencies, never the app's root). The app's own modules got Android
permissions inferred from `@RequiresPermission`, and nothing else.

- [x] The app's root `lucent.json`, with the package schema, read and
      merged like a package's: Info.plist keys, entitlements, pods, Gradle
      dependencies, Android permissions and components, native sources,
      extensions (#296). Where the app gives a value of its own, it wins;
      its launch modules and components' classes are named as its modules
      are.
- [x] Per-app options: a package declares the values an app must or may
      set (an API key, a usage string), and the app's `lucent.json` sets
      them. The app's values win over a package's (#297):
      `{{name}}` in a package's Info.plist values, entitlements and
      manifest components is the option's value
      ([0109](decisions/0109-a-packages-options-are-names-in-its-lucent-json-the-app-sets.md)).
- [x] The build reruns when it changes, as it does for packages (#296).
- [x] `lucent new module --template sdk-ios-android` writes the keys its
      sample needs into it: its sample (UIDevice, `Build.VERSION`) needs
      none, so it writes no `lucent.json`.
- [x] Tests: a fixture app whose own module needs an Info.plist key and a
      Gradle dependency, in a fresh app (`scripts/smoke-install.ts`, which
      CI's bench job runs, #298): both merge, named by the app, and the
      Android library depends on the artifact. The Expo config plugin
      writes what `resolved.json` holds, the app's needs among them.

**Done when:** an app's own module declares everything a package can, and
an app sets a package's option.

<a id="t112"></a>

### T112: SDK shapes Lucent still refuses

**Goal:** Bind the native shapes that common libraries use and Lucent
still refuses.

- **Status:** in progress: the members a module adds to `NSObject` (#272),
  weak references to SDK objects (#303), categories on other modules'
  classes (#304), overriding Kotlin suspend members (#305), overriding
  Objective-C properties (#306), optional closures and tuples through
  Swift (#307), optionals and enums in Swift collections (#308), C structs
  in Swift collections and optional enums (#309), async initializers and
  effectful property requirements (#310), statics of generic Swift types
  (#311), Swift subscripts (#312), members of protocols with associated
  types (#313), Swift extensions of other modules' classes and categories'
  class properties (#314). Updating the coverage counts needs a macOS
  run.
- **Area:** bindings, compiler.
- **Needs:** nothing.
- **Verify:** V1, V4.
- **Where:** `bindgen/src/binding-plan.ts`, `emit/native.ts`,
  `emit/objc-subclass.ts`, `emit/swift.ts`, `emit/kotlin.ts`,
  `config/sdk-coverage.json`.

- [x] `WeakRef` to an SDK object, and `WeakMap` keyed by one, for delegate
      back references
      ([0110](decisions/0110-a-platform-object-is-held-weakly-through-the-platforms-weak-reference.md),
      #303): through ARC's weak references and JNI's weak global ones,
      run on the desktop JNI host and the macOS runtime test.
- [x] Optional closures and tuples through Swift shims (#307): an
      optional block or array, nil for null; a Swift property takes a
      closure as a block.
- [x] Optionals and Objective-C enums inside collections, and tuples
      holding optionals, through Swift shims (#308): an absent element as
      `NSNull`, which Swift bridges from and to nil; an enum as an
      `NSNumber` of its raw value.
- [x] C structs inside collections and tuples, and optional enums
      (#309): a struct element as its bytes, an optional enum as an
      `NSNumber` of its raw value or index, nil for none.
- [ ] The largest skipped buckets in `config/sdk-coverage.json`:
      Objective-C enums crossing to Swift, subscripts (#312: the methods
      `subscript` and `setSubscript`, static ones too,
      [0113](decisions/0113-a-swift-subscript-is-the-methods-subscript-and-setsubscript.md)),
      static members of generic types (#311: a static method's call fixes
      the type's parameters its signature names), and optional numbers and
      booleans.
- [x] Members of protocols with associated types, where the conforming
      type fixes them
      ([0114](decisions/0114-a-protocols-member-is-called-on-its-value-opened.md),
      #313): on a value typed with them (`Store<string>`), opened as the
      type conforming; arguments and results cast to and from them, `Self`
      boxed as its type. A protocol's mutating members and setters write
      the value back to its box, and a struct that conforms crosses as the
      protocol's value.
- [x] Async and throwing property requirements, and async initializers as
      constructors (#310): a requirement's getter returns a promise or
      throws, which the proxy declares `get async throws`; an async
      initializer is a static factory returning a promise
      (`Model.withContentsOf(url)`, `Model.make()`).
- [x] A Lucent `async` method overriding a Kotlin class's `suspend` member
      (`CoroutineWorker.doWork` in T131 needs it) (#305): the Java
      subclass's override passes the continuation on, as a proxy does,
      run on the desktop JNI host with Kotlin's standard library.
- [x] Overriding Objective-C properties in a Lucent subclass
      ([0112](decisions/0112-an-ios-classs-properties-are-accessors-a-subclass-overrides.md),
      #306): an iOS class's declarations make its properties accessors,
      which the subclass's override; `super.name` reads and writes the
      base's.
- [x] The instance members a module's Objective-C categories add to
      `NSObject`, from `<module>@ObjectiveC.symbols.json`: UIKit's
      `accessibilityLabel` is every object's
      ([0106](decisions/0106-members-a-module-adds-to-nsobject-are-every-objects.md),
      #272).
- [x] Members a module adds to another module's other classes (UIKit's
      `row` and `section` on `NSIndexPath`), and the class methods
      categories add
      ([0111](decisions/0111-a-category-on-any-modules-class-is-bound-as-nsobjects-are.md),
      #304): from each extension graph, class methods merged into the class
      by a namespace, initializers as class methods named by selectors.
- [x] Swift extensions' members a module adds to another module's class,
      and a category's class properties
      ([0115](decisions/0115-a-swift-extension-of-another-modules-class-is-bound-as-its-categories-are.md),
      #314): a Swift extension's members join the module's extension class,
      called on the extended class through shims, its initializers class
      methods; class properties merge into the class as a namespace's
      `const` or `let`, which the compiler follows to their declaration.
- [ ] `config/sdk-coverage.json` updated with the new counts.

**Done when:** each item has a binding test on its platform, and the
coverage file shows the change.

<a id="t113"></a>

### T113: Classes that extend `EventEmitter`

**Goal:** `class Player extends EventEmitter<Events>` works, so a native
object has `addListener` itself, as Expo's shared objects do.

- **Status:** done (2026-10-15, #295).
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V1, V2, V3.
- **Where:** `emit/classes.ts`, `events.h`, `emit/bindings.ts`.

A class could hold an `EventEmitter` field, but extending one failed with
LUCENT1005 ("classes can only extend Lucent classes, Error and SDK
classes").

- [x] A Lucent class extends `EventEmitter`, and its instances cross to
      JavaScript with `addListener`, `emit`, `removeAllListeners` and
      `listenerCount`, keeping their identity (#295): its C++ class
      derives from the emitter, and its prototype has the emitter's
      methods.
- [x] `onObserved` works per instance.
- [x] e2e: `emitter-classes`.

**Done when:** the case passes natively and as JavaScript.

<a id="t114"></a>

### T114: Native code that calls Lucent modules

**Goal:** Swift, Kotlin or C++ the app or another library ships calls a
Lucent module's exports, as other native code calls a Nitro object or an
Expo module.

- **Status:** in progress: the API's shape is decided (#315), entries
  pass optionals, arrays, records and platform objects (#316), exported
  classes have entries (#317), Kotlin (#318) and Swift (#319) call them,
  with a guide (#320), taking turns on the module's actor (#321); the
  bare example's Swift and Kotlin call a module (#322). Done once the
  device check has run it.
- **Area:** compiler, runtime, iOS and Android hosts.
- **Needs:** nothing; [T130](#t130)'s entry points are done.
- **Verify:** V1, V3, V4, V5.
- **Where:** `emit/entries.ts`, `entries.h`, `runtime/native`.

- [x] A decision: which exports are callable from native code, and the
      generated API's shape on each side (a C header, a Swift module, a
      Kotlin class)
      ([0116](decisions/0116-native-code-calls-a-modules-exports-through-generated-swift-and-kotlin.md),
      #315).
- [x] Entries for the rest of what crosses: optionals, arrays, records and
      platform objects (#316): a `lucent_value`, run on the host and, for
      platform objects, the desktop JNI host. A platform file exports what
      takes or gives a platform object for native code alone
      ([0117](decisions/0117-a-platform-file-exports-what-takes-platform-objects-for-native-code-alone.md)).
- [x] Entries for exported classes: a constructor, methods, properties and
      a release, with instances as `lucent_object` (#317): the ancestors'
      members too, statics without an instance, run on the host.
- [x] The Swift API in `LucentNative`, and its `LucentError`, run on the
      host with Linux's Swift (#319): an enum per module with static
      functions, `async throws` ones for async exports, and a wrapper class
      per exported class, released when it goes. The pod's public headers
      are the entries' C header and the types it passes.
- [x] The Kotlin API in the generated library, its JNI glue and its
      `LucentException`, run on the desktop JNI host (#318): top-level
      functions Java sees as `Exports`, `suspend` ones for async exports,
      and an open wrapper class per exported class, closed or finalized to
      release its instance.
- [x] A guide: [Call a module from Swift or Kotlin](https://lucent-lang.dev/docs/guides/call-a-module-from-swift-or-kotlin/)
      (#320).
- [x] Calls run on the module's actor, through the native root's entry
      points, with the same argument checks as calls from JavaScript
      (#321): Swift tasks and Kotlin threads calling at once take turns, as
      each call holds the actor; a value's kind and an instance's class are
      checked as JavaScript's are (#316, #317).
- [ ] Tests: a fixture app's Swift and Kotlin call a Lucent function and
      use an instance of an exported class. Written (#322): the bare
      example's `AppDelegate.swift` and `MainApplication.kt` make a
      `Tally` at launch, call it and a function, and keep it; the Platform
      screen reads what they did from JavaScript. It runs with the device
      check, on the simulator and the emulator.

**Done when:** the fixture runs on the simulator and the emulator.

<a id="t115"></a>

### T115: Native configuration packages can't declare yet

**Goal:** A package declares every piece of native configuration its
platform code needs, so no app edits its native project by hand.

- **Status:** in progress: Android queries, features and meta-data (#299),
  privacy manifests (#300), Gradle plugins (#301), the window apps'
  fixture package (#302); done once the nightly window builds it.
- **Area:** tooling, compiler.
- **Needs:** nothing.
- **Verify:** V1, V5, V6.
- **Where:** `package-schema.ts`, `package-config.ts`,
  `native-build-files.ts`, `app.plugin.js`.

- [x] iOS privacy manifests (`PrivacyInfo.xcprivacy`), merged into the
      app's (#300): `ios.privacy`, in Apple's keys, merged into the pod's
      manifest in a resource bundle of its own, which Xcode's privacy
      report reads with the app's.
- [x] Android `<queries>`, `<uses-feature>`, and `<meta-data>` on the
      `<application>` (#299): in the library's manifest, which Android
      merges into the app's. Queries join, a feature any package requires
      is required, and a meta-data name has one value, the app's winning;
      a value can be an option's.
- [x] Gradle plugins a dependency needs (such as Google services), applied
      to the app's build (#301): `android.gradlePlugins`, plugin id → its
      artifact. The Expo config plugin puts the artifact on the
      buildscript classpath and applies the plugin; one the app's build
      has already, at any version, stays the app's.
- [x] Each has a merge rule, and a bare app is told what its project
      lacks, as for Info.plist keys today (#301): a plugin's artifact
      takes its highest version, and two artifacts for one id fail.
      `lucent build` names the classpath line and the `apply` line a bare
      app lacks, counting a `plugins` block and the version catalog. The
      rest go into the library's manifest or the pod's privacy manifest,
      which the app's build merges, so a bare app adds nothing for them.
- [x] A fixture package declaring each piece (#302): the window apps'
      `lucent-window-kit` (`scripts/window-app.ts`), whose bare and Expo
      apps are fresh on each release. A bare app adds the Gradle lines
      `lucent build` names; the check finds each piece in the Release
      build.
- [ ] The nightly window builds and runs it on every app.

**Done when:** a fixture package declaring each one builds in a fresh bare
and Expo app with no manual step.

## View parity

<a id="t120"></a>

### T120: Instances of exported classes as view props

**Goal:** `<VideoView player={player} />` works, as Nitro's Hybrid Object
props and Expo's shared-object props do, per
[0075](decisions/0075-instances-of-exported-classes-as-view-props.md).

- **Status:** done (2026-10-13).
- **Area:** views, runtime, compiler.
- **Needs:** nothing.
- **Verify:** V1, V2, V3, V5.
- **Where:** `ui/contract.ts`, `ui/transport.ts`, `rn/LucentViewValues*`,
  `runtime/js/views.js`.

- [x] Transport (C-VIEW v3.0): the prop crosses Fabric as the instance's
      id in its host plus the runtime id. A value that is not an instance
      of the declared class is a `TypeError` at render. The ids and the
      views runtime's side (#245), the description's `instance` type, the
      proxy's shape and the React types (#247).
- [x] The commit's props find the instance as React Native parses them, in
      the JavaScript call that commits, and hold it; the mount holds it
      while it shows it. Not later, on the main thread: by then JavaScript
      may have let it go
      ([0098](decisions/0098-an-instance-prop-is-held-from-its-commit-and-checked-by-member.md)).
      An id of a freed instance or of a torn-down runtime is reported and
      reads as missing.
- [x] Members only main-thread code touches are the main thread's. A member
      module code also touches, one of them writing it, is refused where a
      view uses it, naming both uses (`analysis/view-members.ts`,
      LUCENT3022).
- [x] Arrays of instances, and `T | null`.
- [x] `view-ref-props`: an instance prop set, replaced, nulled and freed,
      mounted as a host mounts it, on Mac Catalyst against React Native's
      renderer (`ui/view-ref-props-run.test.ts`; views need the renderer,
      which the e2e host has not). 1,000 mount and unmount cycles return
      the owned counts to baseline (P7).
- [x] The bare example's players screen passes its players as instance
      props (`.views-spike/players.lucent.tsx`).

**Done when:** the case passes and the bare example's players screen uses an
instance prop.

<a id="t121"></a>

### T121: React Native's view props, refs and view libraries

**Goal:** A Lucent component takes the view props every React Native view
takes, as Expo views do, and works inside the view libraries apps use.

- **Status:** done (2026-10-14): view props pass through, the ref measures the
  host, and requests take a signal (#244). The device runs find a
  component's native view by its `testID`, read its label on Android, and
  hear its `onLayout` (#268). The ref is the host view's own (#270), and
  the device runs' Libraries screen puts a component inside Reanimated,
  Gesture Handler and react-native-screens (#271). iOS's accessibility
  API reads the label through the members UIKit adds to `NSObject`
  (#272).
- **Area:** views.
- **Needs:** nothing.
- **Verify:** V1, V5.
- **Where:** `runtime/js/views.js`, `ui/proxy.ts`, the generated
  component types.

Today the proxy passes `style` and the component's own props only, so
`testID`, `nativeID`, `accessibilityLabel`, `onLayout` and the rest are
dropped. A pending command's request settles only on an answer or an
unmount.

- [x] The proxy passes React Native's view props through to the host view,
      and the component's type accepts them (`ViewProps`, minus `children`
      unless the component declares it). The component's own props and
      events take the place of the view props of their names (#244).
- [x] The ref has the host's `measure` and `measureInWindow` beside the
      component's commands; a command with either name is a diagnostic
      (LUCENT3021, #244).
- [x] The ref is the host view's own, with the commands on it, so what
      finds a view by its ref finds a component's
      ([0105](decisions/0105-a-components-ref-is-its-host-views-own.md),
      #270).
- [x] A caller can cancel a pending command's request with an
      `AbortSignal`, passed as `{ signal }` after its arguments (#244).
- [x] A component inside Reanimated's animated views, Gesture Handler's
      detectors and react-native-screens' screens mounts, animates and
      receives touches: the device runs' Libraries screen (#271), on iOS
      with the detector's recognizers on the component's own view (the
      Fabric view's contentView), since nothing taps there.
- [x] Tests: `testID` reaches the native view and `onLayout` fires, on
      the simulator and emulator, and Android's accessibility API reads a
      label: the Platform screen's `Card` (#268).
- [x] Tests: iOS's accessibility API reads the label, a member UIKit adds
      to `NSObject` ([T112](#t112), #272).

**Done when:** a component accepts every documented React Native view prop,
and the library cases pass on the simulator and emulator.

<a id="t122"></a>

### T122: UIKit components with a view-controller root

**Goal:** A component's iOS branch returns a `UIViewController`, such as
`AVPlayerViewController`, contained the way the SwiftUI host is.

- **Status:** in progress: the root, its containment and sizing (#324),
  and what its code presents (#325); the spike is what's left.
- **Area:** views, iOS host.
- **Needs:** nothing.
- **Verify:** V1, V4, V5.
- **Where:** `ui/roots.ts`, `rn/LucentComponentView.mm`.

- [x] A branch returning a `UIViewController` is a component. The host
      contains it (`addChildViewController:`, the content view, the
      parent's traits, no safe-area insets) and releases it on dispose
      ([0118](decisions/0118-a-components-ios-root-may-be-a-view-controller.md),
      #324). A setup mixing it with a view is refused.
- [x] Sizing: style or flex only, or the `preferredContentSize`, whose
      changes the host observes and measures again (#324).
- [x] Commands present from the contained controller. A modal it shows
      outlives a commit and is dismissed on dispose (#325): what `present`
      shows from the mount's code, before its first `await`, belongs to
      the mount's scope, from its root when that's a view controller.
- [ ] A spike: `AVPlayerViewController` with a Lucent `AVPlayer` enters
      and leaves fullscreen and picture in picture, survives a recycle,
      and reports its delegate's events as component events.

**Done when:** the spike runs on the simulator in CI. Android's
counterpart, a `Fragment` root, is in [T131](#t131).

<a id="t123"></a>

### T123: Native objects and helpers in SwiftUI and Compose bodies

**Goal:** Toolkit bodies take what UIKit and Android bodies take: instance
props, and helper functions with children and bindings.

- **Status:** in progress (#328, #335 to #337, #339 to #341).
- **Area:** views, compiler.
- **Needs:** T120.
- **Verify:** V1, V4, V5.
- **Where:** `emit/swiftui.ts`, `ui/compose.ts`.

- [x] What the setup computes for a body (its values, a helper's, what a
      callback passes) is setup code to the analyses, so LUCENT3022 checks
      what it calls (#328). Compose bodies build on hosts without the
      Android SDK, against stand-ins (`ui/toolkit-build.ts`).
- [x] An instance prop reaches a SwiftUI or Compose body, observed on the
      main thread (#335, decision 0121): the body shows what the setup
      computes from it. A list of instances too (#336, decision 0122).
- [x] A value a body's callback passes is computed when the callback runs,
      as JavaScript does, not when what it reads changes (#337).
- [x] Helper view functions take toolkit values (#339): a parameter of the
      toolkit's type, which their user writes.
- [x] Helper view functions take children and bindings (#340).
- [x] Helper view functions take destructured props (#341).
- [ ] Helper view functions show lists of their own.
- [ ] Tests on the simulator and emulator.

**Done when:** the views limitations list neither restriction.

<a id="t124"></a>

### T124: A component's ref as a module function's argument

**Goal:** JavaScript passes a component's ref to a module function, which
gets the native view on the main thread, as view-capture and map-camera
APIs need.

- **Status:** in progress: lucent:ui's `ComponentView` and the platforms'
  `viewOf` (#326); the capture test on devices is what's left.
- **Area:** views, runtime, compiler.
- **Needs:** nothing.
- **Verify:** V1, V2, V5.
- **Where:** `ui/contract.ts`, `runtime/js/views.js`, `emit/bindings.ts`,
  `rn/`.

- [x] A parameter typed as a component's view reads the mount behind the
      ref. Its native view is reachable only inside `main()` (#326,
      [0120](decisions/0120-a-components-ref-crosses-to-module-code-as-a-component-view.md)):
      lucent:ui's `ComponentView`, read with lucent:ios's and
      lucent:android's `viewOf`.
- [x] A ref of an unmounted view, or of another runtime, is a typed error
      (#326): `viewOf` throws an `InvalidStateError` once the mount the
      ref named has ended, a reload's included; a value that isn't a
      component's ref is a TypeError.
- [ ] Tests: a module captures a component's view as an image on the
      simulator and emulator.

**Done when:** the capture test passes on both.

<a id="t125"></a>

### T125: Android views made after setup keep the Activity's context

**Goal:** A native-JSX view made on a later commit (a list item, a branch
shown later) gets the same themed context as the views made at setup.

- **Status:** in progress (#327): runs on a desktop JVM; the emulator
  check remains.
- **Area:** views, Android host.
- **Needs:** nothing.
- **Verify:** V1, V4, V5.
- **Where:** `rn/LucentViewsAndroid.cpp`, `platform/android.h`,
  `emit/native.ts`.

Only setup ran inside a `HostViewEntry` (`LucentViewsAndroid.cpp`), so
views made during an update or a command fell back to `appContext()`, lost
the Activity's theme, and one list could mix contexts. Found by reading the
code; confirmed by a test first.

- [x] A failing test (`runtime/test/jni/jni_test.cpp`, on a desktop JVM):
      code a mount runs in its content, outside its host's calls, gets no
      context. It now gets its root view's.
- [x] Updates and commands run inside the view's entry, as setup does;
      callbacks the setup made take the root view's context.
- [ ] On the emulator: a list item added after setup has the Activity's
      themed context.

**Done when:** the test passes on the emulator.

## Execution modes

<a id="t130"></a>

### T130: A native root: module code with no JavaScript runtime

**Goal:** Lucent code runs when the platform starts the app for a
background task, a push or an extension, before or without any JavaScript
runtime.

- **Status:** done (2026-10-13): module state's lifetime is decided
  ([0090](decisions/0090-module-state-resets-only-when-nothing-native-holds-it.md),
  #228), and the runtime's native root keeps it (#231). Entry points run
  exports with no JavaScript runtime on the host (#233), and code with no
  runtime fails as after a reload (#234). Launch modules start state at
  launch (#235, #236). The device runs' Platform screen checks a launch
  module's state on the simulator and the emulator (#237), and passes on
  both (2026-10-13).
- **Area:** runtime, compiler.
- **Needs:** nothing for the decision and the root; [T110](#t110) for
  `launch` on iOS, which runs from the app-delegate subscriber.
- **Verify:** V1, V2, V3, V4.
- **Where:** `jsi/host.h`, `hooks.h`, `native_root.h`, `entries.h`,
  `scheduler.h`, `emit/identity.ts`, `emit/entries.ts`,
  `emit/bindings.ts`, `runtime/native/android/CMakeLists.txt`.

Today module state belongs to the process, but a module's top level runs
when a JavaScript runtime installs Lucent, and there is no native way in.
[native-platform.md](design/native-platform.md) lists the open questions.

- [x] A decision: when a module's top level runs and when its state
      resets once native roots exist. At first use from JavaScript, an
      entry point or launch, and reset only when the last runtime goes
      while no native root holds it
      ([0090](decisions/0090-module-state-resets-only-when-nothing-native-holds-it.md)).
- [x] A native root: the runtime starts its actors and contexts with no
      `Host`. A JavaScript `Host` that installs later sees the same module
      state: `Host::create` no longer resets state a native root holds,
      `onDestroy` hooks registered with no runtime run when the root ends,
      and work an entry point starts belongs to that call's scope, not to
      the last attached runtime (`currentRuntime()`). `native_root.h`:
      module state's generations, holds, and `NativeCall` (#231).
- [x] On Android, the code loads without React Native: the native root's
      library is loaded before `appmodules`, or built apart from it. Built
      apart, as `liblucent.so`, and launch's timing on each platform, are
      decided
      ([0092](decisions/0092-launch-runs-in-the-apps-launch-and-android-loads-lucent-by-itself.md)).
      Lucent loads `appmodules` itself instead
      ([0095](decisions/0095-android-loads-appmodules-itself-for-launch.md),
      #236).
- [x] Native entry points: generated C functions that run a module
      function on its actor, for the glue of T131 to T133, and for T114,
      to call. Their ABI is decided
      ([0091](decisions/0091-entry-points-are-c-functions-named-for-their-export.md)).
      `lucent_entries.h` and `entries.h`, for numbers, booleans, `bigint`,
      strings and `Uint8Array` (#233).
- [x] `lucent.json` `launch`: modules created at app launch, before the
      first frame, so they can register what the OS requires by then.
      Packages list them, LUCENT3015 names one that isn't, and iOS's
      `LucentAppDelegate` creates them, `lucent build` naming a bare app's
      missing call (#235). Android's `LucentInitializer` does (#236).
- [x] Without a runtime, a call that needs one (a JavaScript callback, a
      `JSValue`) throws a typed error. An event with no listener is
      dropped. It fails as after a reload, with `AbortError`
      ([0093](decisions/0093-a-callback-with-no-runtime-fails-as-after-a-reload.md)).
- [x] Tests: a host test calls an entry point with no `Host`, then
      attaches one that reads the state; `actor_test.cpp` covers startup
      with no runtime. `host_test.cpp` starts state from a `NativeCall` a
      runtime then shares (#231), and `native-entries.test.ts` calls
      generated entries with no runtime linked (#233). `actor_test.cpp`
      starts module state from entries with no runtime, from the main
      thread too, and `host_test.cpp` calls a gone runtime's callback from
      a native call (#234).

**Done when:** an entry point runs module code with no JavaScript runtime,
on host, simulator and emulator.

<a id="t131"></a>

### T131: Android classes the OS instantiates, written in Lucent

**Goal:** A `Service`, `BroadcastReceiver`, WorkManager `Worker`,
`AppWidgetProvider`, `TileService`, `FirebaseMessagingService` or
`Fragment` is a Lucent class.

- **Status:** done (2026-10-14): decided
  ([0097](decisions/0097-exported-classes-extending-android-classes-are-os-made.md)),
  and an exported class extending an Android class is one the OS makes,
  on the desktop JVM host (#240). The device runs' Platform screen sends a
  broadcast to a Lucent `BroadcastReceiver` (`examples/lucent-broadcast`,
  #243), and a `FragmentManager` makes a Lucent `Fragment` again by its
  name (`examples/lucent-fragment`, #263). A component's Android root may
  be a `Fragment` (#264). On the emulator, WorkManager runs a Lucent
  `Worker` with the app in the background (#265), and a Lucent
  `MediaSessionService` plays on as its Activity is made again (#266).
- **Area:** Android host, compiler.
- **Needs:** T130; T112 for `CoroutineWorker`.
- **Verify:** V1, V4, V5.
- **Where:** `emit/java.ts`, `native-build-files.ts`, `package-config.ts`.

Today `android.components` declares a service, receiver or provider, but
its class must be Java or Kotlin the package ships.

- [x] A decision: how a class is marked as OS-instantiated without a list
      of bases (WorkManager and `FragmentManager` instantiate by name, with
      no manifest entry), which constructors its Java class declares, and
      how its name stays stable. Exporting it marks it, its constructor's
      parameters are the Java one's, and its name comes from the module's
      path
      ([0097](decisions/0097-exported-classes-extending-android-classes-are-os-made.md)).
- [x] A Lucent class extending an OS-instantiated base gets a generated
      Java subclass with the constructor the OS calls (no arguments, or
      `Context` and `WorkerParameters` for a `Worker`). It creates its
      Lucent instance on first use, on the calling thread, through the
      native root. Its Java name is stable across builds, since WorkManager
      stores it. `NativeProxy.adopt` and the generated factory; the class
      calls its base's members on the object the OS made (#240).
- [x] `lucent.json` `android.components[].class` names the Lucent class,
      and the manifest's `android:name` is the generated class.
      `foregroundServiceType`, intent filters and permissions work as
      today (#240).
- [x] An override runs while its caller waits, whatever it returns, and
      `super.name(…)` calls the base's implementation, as a `Fragment`'s
      or a `Service`'s lifecycle requires
      ([0103](decisions/0103-android-overrides-run-while-the-caller-waits.md),
      #262).
- [x] A `Fragment` shown through a `FragmentActivity`'s manager. When
      the OS recreates it, a new Lucent instance is made, and its
      `onCreate` gets the state it saved. The device runs' Platform screen
      saves and restores a back stack entry holding one, which makes it
      again by its name (`examples/lucent-fragment`, #263).
- [x] A `Fragment` as a component's Android root (the counterpart of
      [T122](#t122)): the host adds it to the Activity's `FragmentManager`
      over a container its view holds, and drops the ones Android restores
      with a recreated Activity. The Platform screen shows one
      (`lucent-fragment`'s `Card`)
      ([0104](decisions/0104-a-components-android-root-may-be-a-fragment.md),
      #264).
- [x] Tests on the desktop JVM host (`test/fake-android.ts`): an
      OS-style instantiation (`os-classes.test.ts`, #240). On the emulator: a periodic `Worker` that
      runs with the app in the background (`lucent-background-task`'s
      `Refresh`, which a `Class<? extends ListenableWorker>` parameter
      takes, #265), and a foreground `MediaSessionService` that survives
      the Activity's recreation (`lucent-media`'s `Playback`, which the
      device runs' Media screen starts, #266).

**Done when:** both emulator fixtures run in CI.

<a id="t132"></a>

### T132: iOS background execution

**Goal:** Background tasks, background URL sessions and silent pushes run
Lucent code, with no JavaScript, as `expo-background-task` and
`expo-notifications` tasks do.

- **Status:** done (2026-10-14): decided
  ([0096](decisions/0096-ios-background-tasks-are-package-code-a-launch-module-registers.md)),
  and a package's launch module registers a handler that ends its own
  work (#238), which the simulator's device run checks (2026-10-13).
  Relaunches for background URL sessions and silent pushes moved to
  [T137](#t137).
- **Area:** iOS host, runtime, tooling.
- **Needs:** T110, T130.
- **Verify:** V1, V4, V5.
- **Where:** `platform/`, `runtime/native`, `app.plugin.js`.

- [x] A `launch` module registers `BGTaskScheduler` handlers before the
      app finishes launching. The handler runs Lucent code through the
      native root. `examples/lucent-background-task` (#238).
- [x] The task's expiration aborts an `AbortSignal` the handler holds, and
      the handler reports completion (#238).
- Moved to [T137](#t137): `backgroundURLSession` and `remoteNotification`
  (T110) relaunch the process into the native root when it isn't running.
- [x] `UIBackgroundModes` and `BGTaskSchedulerPermittedIdentifiers` come
      from `lucent.json` `ios.infoPlist`. Whether the build checks them is
      a decision: recognizing `BGTaskScheduler` calls by name would be a
      catalog entry. It checks them as any entry
      ([0096](decisions/0096-ios-background-tasks-are-package-code-a-launch-module-registers.md)).
- [x] Tests: the simulator runs a task through a debug-build trigger,
      since the scheduler doesn't launch tasks on the simulator. The
      Platform screen checks that launch registered the handler, and runs
      it with a stand-in task to its end and to its expiration
      ([0096](decisions/0096-ios-background-tasks-are-package-code-a-launch-module-registers.md)),
      passing on the simulator (2026-10-13).

**Done when:** the trigger runs a registered task's Lucent handler on the
simulator in CI.

<a id="t133"></a>

### T133: iOS app extensions and widgets

**Goal:** A package's Lucent code runs in an app extension: a widget with
a SwiftUI body, a notification service extension or a share extension.

- **Status:** in progress (#345 to #356): decided (0124), its
  `lucent.json` fields, classes the OS makes, the API limits, the build,
  the targets' manifest, the targets in Expo and bare apps, App Groups, a
  widget's body, its lists and dates, and its provider.
- **Area:** iOS host, compiler, tooling.
- **Needs:** T130.
- **Verify:** V1, V4, V5, V6.
- **Where:** `native-build-files.ts`, `emit/swiftui.ts`,
  `emit/swift-proxy.ts`, `app.plugin.js`, `runtime/native`.

- [x] A decision: how a package declares an extension target in
      `lucent.json`, which modules it includes, and how a Lucent class
      becomes its principal class or its widget: decision 0124 (#345).
- [x] `ios.appExtensions` and `ios.appGroups` in `lucent.json`, checked
      and merged as `android.components` are; App Groups are an
      entitlement of the app's already (#346).
- [x] An exported class extending an iOS class gets an Objective-C class
      the OS makes by name, `LucentApp_<module>_<Class>`, whose `init`
      makes its Lucent instance through the native root (#347).
- [x] A widget's body: neither a component nor a module function, but in
      the widget's build a C++ function of its entry computing each value
      its SwiftUI view shows, once, and the view, reading them from a
      struct. Callbacks, bindings, signals and lists are refused, and
      LUCENT3019 a body that draws no entry (#353).
- [x] A widget's provider: WidgetKit's Swift written from its provider
      class (its `Widget`, a `TimelineProvider` calling the provider's
      methods through C functions of its glue, and the entry holding the
      body's values), LUCENT3019 a provider whose methods don't mirror
      TimelineProvider's, and its target in the manifest, whose one source
      is the `@main` bundle (#354).
- [x] A widget's body shows a list of its entry's items (`ForEach`): each
      item's key and values computed with the entry's, its rows reading
      them (#355).
- [x] A widget's body shows its entry's `Date`s, as SwiftUI's `Text`
      styles do: SwiftUI's members taking a `Date` are declared in
      lucent:swiftui, and a date crosses as its seconds since 1970 (#356).
- [x] The extension links the Lucent runtime and those modules without
      React Native, through a second native build of the same program: a
      compile of the modules its code reaches into
      `ios-extensions/<name>/`, and its subspec of
      `LucentExtensions.podspec` (#349).
- [x] APIs unavailable to extensions are refused in extension code, from
      their availability attributes: bindgen records `iOSAppExtension`
      unavailability, and LUCENT3018 refuses it in the modules an
      extension's code reaches, with Lucent's own `present()`,
      `onAppEvent()` and `onSceneEvent()` (#348).
- [x] The runtime's own calls to `UIApplication` (`platform/ios_ui.mm`)
      stay out of an extension's build (`LUCENT_APP_EXTENSION`), with the
      lifecycle observers, the Expo subscriber and the notification
      delegate (#349).
- [x] What adding a target takes, recorded for the integrations:
      `ios-extensions.json`, with each target's Info.plist, entitlements
      (the app's App Groups among them) and the source linking its
      principal class, which LUCENT3019 checks the OS can make (#350).
- [x] The Expo plugin adds the target: the Xcode project's, embedded in
      the app, its files in `ios/<name>/`, and the Podfile's (#351).
- [x] A bare app gets the target from a CLI command: `lucent init`, run
      again, and `lucent build` warns while it's missing (#352).
- [x] App Groups: the entitlement from `lucent.json`, so the app and its
      extension share storage: the app's (#346) and each extension's
      (#350).
- [ ] Tests: a widget fixture and a notification service fixture build
      and run on the simulator.

**Done when:** both fixtures run on the simulator in CI.

<a id="t134"></a>

### T134: Calls from worklet runtimes

**Goal:** Worklets call Lucent modules, as Nitro objects and Expo modules
work on `react-native-worklets` runtimes.

- **Status:** in progress (#342, #343, #344): decided (0123), attached
  hosts and the instance rules; a worklet run on devices remains.
- **Area:** runtime, tooling.
- **Needs:** nothing.
- **Verify:** V1, V3, V5.
- **Where:** `jsi/host.h`, `rn/LucentModule.cpp`, `runtime/js`.

- [x] A decision: how Lucent installs on a worklet runtime without naming
      a library, and what a call from one does (a synchronous export on
      that runtime's thread under its module's actor, the main-thread rule
      on the UI runtime, async results and callbacks posted to that
      runtime's scheduler, instances shared across runtimes): decision
      0123 (#342).
- [x] A `Host` per worklet runtime, torn down with it. Work that module
      code or an entry point starts stays with the runtime that started
      it, never with the worklet runtime attached last: an attached host,
      made at the runtime's first call, never the default runtime and
      never holding module state; `Host::attach` gives it a scheduler
      (#343).
- [x] A host test with two runtimes: a carried function's calls, async
      calls with and without a scheduler, a reload while a worklet
      runtime lives, and a UI-runtime call while a callback waits for the
      main thread (#343).
- [x] An object of another runtime's is refused as an instance, and a
      `JSValue` given to another runtime throws a `TypeError`: a worklet
      runtime gets its own object for an instance, with its own
      prototype, and a copy carrying another runtime's native state is
      refused (#344).
- [ ] The example app calls a synchronous export from a UI-runtime
      worklet on the simulator and emulator.

**Done when:** the example app's worklet call runs in CI.

<a id="t135"></a>

### T135: JavaScript tasks from background entry points

**Goal:** A background entry point runs a JavaScript function, as
`expo-task-manager` does, for apps that keep task logic in JavaScript.

- **Status:** blocked: a decision on whether Lucent offers it, since Lucent
  code already runs natively there. If it does, it needs T131 and T132.
- **Area:** iOS and Android hosts, runtime.
- **Needs:** the decision; then T131, T132.
- **Verify:** V1, V5.
- **Where:** `runtime/native`, `runtime/js`.

- [ ] The decision.
- [ ] If accepted: React Native started headless from the entry point
      (Android's `HeadlessJsTaskService`, a background launch on iOS), and
      the JavaScript function run with the event.

**Done when:** the decision is recorded, and if accepted, a fixture runs on
both platforms.

<a id="t136"></a>

### T136: App Intents, Live Activities and Android widget bodies

**Goal:** Interactive widgets, controls, Siri shortcuts and Live
Activities run Lucent code, and Android widgets render from Lucent.

- **Status:** waiting; needs T133 (T131 is done).
- **Area:** iOS and Android hosts, compiler.
- **Needs:** T131, T133.
- **Verify:** V1, V4, V5.
- **Where:** `emit/swift-proxy.ts`, `emit/swiftui.ts`, `emit/java.ts`.

App Intents and ActivityKit attributes are Swift types the build tools
read, so Lucent has to generate them.

- [ ] A decision: how a Lucent class becomes an `AppIntent` or Live
      Activity attributes type, with the metadata Xcode extracts.
- [ ] A Live Activity started and updated from module code, with its
      SwiftUI body.
- [ ] Android: an `AppWidgetProvider` (T131) renders `RemoteViews` built
      in Lucent.
- [ ] Tests: an intent run from a widget button, and a Live Activity, on
      the simulator; a widget update on the emulator.

**Done when:** the three fixtures run in CI.

<a id="t137"></a>

### T137: Relaunches for background URL sessions and silent pushes

**Goal:** A background URL session's events and a silent push reach Lucent
code in a process iOS started for them, with no JavaScript, as
`expo-notifications`' background tasks do.

- **Status:** ready; split from [T132](#t132) (2026-10-14).
- **Area:** iOS host, runtime.
- **Needs:** T110, T132.
- **Verify:** V1, V4, V5.
- **Where:** `platform/ios_app_delegate.mm`, `runtime/native`.

The app delegate's `backgroundURLSession` and `remoteNotification` events
exist (T110). A launch module that subscribes to them runs before the app
finishes launching, so a relaunched process may already deliver them.
Nothing checks it yet.

- [ ] A launch module's `backgroundURLSession` subscriber, in a process
      iOS started for the session, makes the session again by its
      identifier and calls the completion handler once its events arrive.
- [ ] A launch module's `remoteNotification` subscriber gets a
      `content-available` push in a process iOS started for it, and
      reports its fetch result.
- [ ] Tests: the simulator delivers a background push (`xcrun simctl
push`) to the app after it ended, and the device run checks that the
      handler ran.

**Done when:** a silent push starts the ended app on the simulator in CI,
and its Lucent handler runs.

## Distribution

<a id="t140"></a>

### T140: A window of stable React Native and Expo releases, run

**Goal:** Apps on every release in the window build and run, and
`lucent create` starts an app on the newest stable release.

- **Status:** in progress: the window is React Native 0.86 to 0.88 and Expo
  SDK 57 and 58, with 0.89 and SDK 59 as the prerelease lane, where the
  example apps stay
  ([0074](decisions/0074-a-window-of-stable-react-native-and-expo-releases.md),
  [0079](decisions/0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md),
  [0127](decisions/0127-react-native-0-88-and-expo-sdk-58-join-the-window.md)).
  `lucent doctor` checks it, the build identity carries the React Native
  release, and CI compiles against each release's headers (#190, #191,
  #194, #195, #200, as T75). `lucent create` starts on 0.87 and SDK 57
  (#204), then on 0.88 and SDK 58 when they joined the window (#363). window.yml builds ten fresh apps nightly and runs each on the
  simulator or the emulator, all green on 2026-10-12.
- **Area:** tooling, verification.
- **Needs:** nothing.
- **Verify:** V5, V6.
- **Where:** `scripts/window-app.ts`, `scripts/device-check.ts`,
  `.github/workflows/window.yml`, `cli/templates/projects.ts`.

- [x] window.yml launches each app on the simulator or emulator and checks
      that a Lucent module answers and a component mounts and answers
      through its ref.
- [x] `lucent create`'s templates move to the newest stable release (#204).
- [x] The docs list the window, and the website's compatibility page reads
      it from `REQUIREMENTS`.

**Done when:** window.yml runs every app green on three nights in a row.

<a id="t141"></a>

### T141: Builds from Xcode, and a package's pods in Expo apps

**Goal:** An iOS build from Xcode alone is current, and a package's own pods
bind in an Expo app.

- **Status:** done (2026-10-14).
- **Area:** tooling, iOS host.
- **Needs:** nothing.
- **Verify:** V4, V5, V6.
- **Where:** `runtime/native` (podspec), `app.plugin.js`,
  `cli/project.ts`.

Before, iOS had no build phase that ran `lucent build`: a build relied on
Metro's watcher or on autolinking at `pod install`. `expo prebuild`
stopped with LUCENT3004 at a package's pod that wasn't installed yet
([decision 0102](decisions/0102-pod-install-binds-the-pods-prebuild-could-not.md)).

- [x] `lucent build` runs from the iOS build once pods are installed, as
      Android's `lucentBuild` task does: the podspec's `script_phase`.
      The podspec records at `pod install` what CocoaPods listed
      (`.pod-install`), and the phase asks for `pod install` when the
      build changes it.
- [x] In `expo prebuild`, a package pod missing from `Podfile.lock` defers
      iOS binding with a warning naming the pod and the step that binds
      it. The plugin then links the native package, so prebuild's
      `pod install` installs the pod. The plugin also calls Lucent's
      CocoaPods hook from the Podfile's `post_install`, which builds once
      the pods are installed and lists the new sources in the pod's target.
- [x] A pod the build still can't find fails with LUCENT3004, and a notice
      names it (`unboundPods`).
- [x] Builds with `use_frameworks! :linkage => :static` and with dynamic
      linkage: CI builds the bare example with each, outside pull requests.
- [x] Tests: a package importing a pod its `lucent.json` declares, in the
      window's fresh Expo and bare apps (`scripts/window-app.ts`), which
      call it on the simulator. The Expo app builds with `pod install` and
      Xcode alone.

**Done when:** the smoke install's Expo app binds a package pod with no
manual step, and Xcode builds without Metro running.

<a id="t142"></a>

### T142: C++ libraries, extension callbacks and borrowed bytes

**Goal:** A package wraps a C++ library, as a Nitro C++ Hybrid Object
does, through typed extensions.

- **Status:** in progress (#357 to #375): decided (0125, 0126, 0128 to
  0131), C++ headers' classes bound and called, C and C++ callbacks,
  signals, bytes from any buffer, prefab modules and pods' headers, and
  the fixture on the JNI host. `lucent-mmkv` waits: MMKV comes from Maven
  Central and CocoaPods, and its benchmark runs on devices, none of which
  this environment reaches; it is T150's first port too.
- **Area:** compiler, bindings, tooling.
- **Needs:** nothing.
- **Verify:** V1, V2, V3, V4, V7.
- **Where:** `extensions/`, `emit/extensions.ts`, `bindgen/src/c-header.ts`,
  `runtime/native` (CMake).

- [x] A decision: how a C++ header's classes, types and exceptions are
      bound, and what is left out: decision 0125 (#357).
- [x] C++ headers in `extensions`: a class is a handle (constructors by
      arity and type, methods, `const` and static members). `std::string`
      and `std::string_view` are strings, `std::vector` of numbers and
      strings an array, `std::optional` an optional, and enums enums.
      Templates and inheritance are refused with reasons: bindgen reads
      them (#358), the compiler binds and declares them (#359) and calls
      them (#360).
- [x] The generated call catches C++ exceptions into an `Error`, so none
      unwinds through Lucent (0125, #360).
- [x] Extension functions take callbacks, called on a stated context:
      decided in 0126
      (#361) and 0128 (#364); bindgen reads a function pointer's and a
      `std::function`'s signature (#362); the runtime runs them at once or
      posted, ends them as they live, and throws what they threw after the
      call (`ext::Callback`, #365); a C function's are bound, declared and
      called, with the analyses' facts and the native-callbacks e2e case
      (#366); a C++ member's `std::function` is one too (#367).
- [x] Extension calls can be cancelled: an `AbortSignal` reaches the
      function as a flag it reads: decided in 0129 (#368). A C
      `const volatile bool *` declared `{ "signal": "flag" }` and a C++
      `const std::atomic<bool> &` are the signal's `requested` flag, set
      by `abort()` on any thread and from JavaScript before its listener
      waits for the module (#369).
- [x] Bytes parameters (`bytes: read|write`) borrow a `NativeBuffer`'s or
      an `ArrayBuffer`'s span for the call instead of copying a
      `Uint8Array`. The copying form stays for `Uint8Array` arguments:
      decided in 0130 (#370); `ext::BytesArg` gives C each one's own
      bytes, a NativeBuffer's under a `Lease` (#371).
- [x] `android.prefab`: Gradle artifacts whose prefab modules the
      runtime's CMake links, with their headers on the extension's include
      path. Vendored frameworks and pods expose headers the same way:
      decided in 0131 (#372); `android.prefab` turns prefab on and links
      each module (#373); the header is read with the modules' `include`
      from the classpath's AARs, the pods' search paths and vendored
      frameworks, and packages.cmake finds the AAR's package name (#374).
- [x] A fixture C++ library with a class, overloads, callbacks and
      exceptions, run on the host and the JNI host: `tally`, in the
      native-cxx-extension e2e case and `cxx-extension-jni.test.ts`, with
      the `ticker` C library's callbacks from another thread (#375).
- [ ] `lucent-mmkv` through MMKV's C++ core on both platforms, with
      `getBuffer` borrowing, benchmarked against react-native-mmkv (P1).

**Done when:** the fixture and `lucent-mmkv` pass on both platforms.

<a id="t143"></a>

### T143: Typed Kotlin and Java sources in packages

**Goal:** A package's own Kotlin and Java sources are typed in Lucent, as
its Swift sources are.

- **Status:** done (2026-10-16): decided
  ([0132](decisions/0132-a-packages-kotlin-and-java-are-compiled-to-be-bound.md))
  (#377), compiled and bound (#378).
- **Area:** bindings, tooling.
- **Needs:** nothing.
- **Verify:** V1, V4.
- **Where:** `bindgen/src/`, `native-build-files.ts`.

A package's Swift sources are typed as `lucent:ios/LucentNative`, and
now its Kotlin and Java as the Java packages they declare.

- [x] `android.nativeSources` Kotlin and Java compile into a jar the SDK
      cache keys on the sources' content, bound as
      `lucent:android/<package>`. The same sources ship in the library, so
      Gradle compiles them for the app. Kotlin compiles with the app's
      own compiler, which `lucentClasspath` records (#378).
- [x] A compile failure is a diagnostic with the compiler's errors, as
      Swift's is with swiftc's (#378).
- [x] Tests on the desktop JVM host: fixtures/greeter's Lucent code calls
      its Kotlin and Java (`package-kotlin-jni.test.ts`, #378).

**Done when:** a fixture package calls its own Kotlin from Lucent.

<a id="t144"></a>

### T144: A web target for shared modules

**Goal:** A Lucent package serves React Native Web apps, as Expo's
`registerWebModule` does, per
[0077](decisions/0077-the-web-is-a-target-for-shared-modules.md).

- **Status:** done (2026-10-17): decided
  ([0133](decisions/0133-a-modules-web-twin-is-typescript-checked-against-its-exports.md))
  (#379); twins are checked (#380); modules bundle for the web (#381);
  the Expo example's web build runs in CI (#382).
- **Area:** tooling, compiler.
- **Needs:** nothing.
- **Verify:** V1, V5.
- **Where:** `metro/`, `platforms.ts`, `lib/sdk/platform.d.ts`.

- [x] On web, Metro resolves a module's proxy to the module run as
      JavaScript, with the JavaScript `lucent:core`, and `PLATFORM` is
      `"web"` (`metro/web.cjs`, release bundles too, #381).
- [x] A `*.web.lucent.ts` twin supplies the exports of a module that uses
      a platform. Without one, the diagnostic names the platform code.
      Native builds leave twins out, and check each with the DOM's types
      against its module's exports (LUCENT3005, #380); `PLATFORM`'s type
      has `"web"`. withLucent's resolver puts a twin in its module's place
      on the web; a module without one fails its transform there, naming
      its platform files or import line (#381).
- [x] Views on web are a diagnostic: a `.lucent.tsx` module's transform,
      and a `lucent:views/*` resolution, fail on the web (#381).
- [x] Tests: the Expo example app's web build runs a shared module and a
      module with a web twin: `App.web.tsx` shows the tasks demo (shared)
      and the crypto demo (Web Crypto twin); `scripts/web-check.ts`
      exports it and runs it in Chromium, the `web-expo` harness in CI
      (#382).

**Done when:** the Expo example's web build passes in CI.

<a id="t145"></a>

### T145: The package distribution matrix

**Goal:** Lucent packages install, build and upgrade the ways real apps
use them.

- **Status:** done (2026-10-17): workspaces and upgrades (#383); Release
  builds and native inputs in the window apps (#384), whose first run is
  CI's nightly window job.
- **Area:** tooling, verification.
- **Needs:** nothing.
- **Verify:** V5, V6.
- **Where:** `scripts/smoke-install.ts`, `scripts/window-app.ts`,
  `scripts/install-matrix.ts`, `packages/compiler/src/packages.ts`.

- [x] Two unrelated Lucent packages with transitive dependencies in one
      app (`install-matrix.ts`, #383).
- [x] Monorepos: pnpm, Yarn and npm workspaces, with a package linked from
      the workspace (#383).
- [x] An upgrade from the previous release of `@lucent-lang/lucent`, and a
      clean rebuild after it: the same files (#383).
- [x] Release builds: Android with R8, iOS with the Release
      configuration, and a package's native resources and assets in both
      (`window-app.ts`: the APK's asset and string resource, the app's
      resource, R8's mapping keeping the package's Kotlin, #384).
- [x] A package's native inputs (sources, resources, frameworks) built in
      a real Xcode project and Gradle build, not only checked:
      `lucent-window-kit`'s Swift, Kotlin and CoreHaptics, called by the
      window app's check (#384).

**Done when:** each case runs in the smoke install or the window job.

## Production candidate

<a id="t150"></a>

### T150: Reference ports for each parity row

**Goal:** Each row of [parity.md](parity.md) is proved by a port of a
widely used Expo or Nitro module (or a stated subset), whose JavaScript API
matches the original.

- **Status:** waiting; each port names its needs, and a port starts when
  they are done.
- **Area:** verification, examples.
- **Needs:** the tasks each port names.
- **Verify:** V4, V5.
- **Where:** `examples/`, `scripts/device-check.ts`, `examples/*/evidence.json`.

Ports already in the repository: `lucent-secure-store`, `lucent-haptics`,
`lucent-camera`, `lucent-http`, `lucent-kv-storage`, `lucent-orbit`,
`lucent-rating` and `lucent-sensors`.

- [ ] `lucent-mmkv`: react-native-mmkv's API (T142).
- [ ] `lucent-file-system`: expo-file-system's file and directory objects,
      with byte streams (T100, T108).
- [ ] `lucent-image`: an expo-image subset, a view with an image object
      prop (T120).
- [ ] `lucent-video`: an expo-video subset: a player object with events, a
      view, a controller root, picture in picture (T113, T120, T122).
- [ ] `lucent-frames`: a camera frame processor subset: an executor, frames
      as handles, a worklet consumer, and a frame drawn by Skia from its
      handle (T107, T109, T134).
- [ ] `lucent-maps` and `lucent-web-view`: subsets of a map view and a web
      view, with events, commands and a ref passed to a module (T121,
      T124).
- [ ] `lucent-text-input`: a native text field with controlled selection,
      IME composition, focus, the keyboard and insets (T121).
- [ ] `lucent-background-task`: expo-background-task's API (T131, T132).
- [ ] `lucent-notifications`: push token, notification delegate, silent
      push and a notification service extension (T110, T133).
- [ ] `lucent-widgets`: a home-screen widget fed from the app (T133).
- [ ] Each port records its evidence in `evidence.json`, and the device
      check runs it on the simulator and emulator.

**Done when:** every parity row names a port that passes in CI.

<a id="t151"></a>

### T151: Lifetime, concurrency and Fabric stress validation

**Goal:** Races, cycles and recycling hold up under stress, on host,
simulator and emulator.

- **Status:** in progress: the host's stress runs (#385); the device
  runs wait for the simulator and emulator.
- **Area:** runtime, views, verification.
- **Needs:** nothing.
- **Verify:** V3, V5, V7.
- **Where:** `packages/runtime/test`, `scripts/device-check.ts`,
  `rn/LucentModule.cpp`.

- [x] Registration, completion and cancellation races, synchronous
      re-entry and late outcomes, under TSan (`stress_test.cpp`, #385).
- [x] Several runtimes alive at once, and reloads while work is in flight
      (`runtimesReloadWithWorkInFlight` in `jsi/host_test.cpp`, #385).
- [x] 1,000 mount and dispose, and subscribe and cancel, cycles after
      warmup: owned counts return to baseline (P7), on the host (#385).
- [ ] Hosts and views recycled while commands, events and measurements
      are in flight.
- [ ] Background and foreground, and Activity recreation, on the
      emulator, with the actors' platform glue.
- [ ] Debug builds: cycle reports reach LogBox on the simulator, and the
      leak count runs after every module's teardown, not before: it waits
      for every actor now (`Actor::afterEveryActor`, #385); LogBox waits
      for the simulator.

**Done when:** each stress run passes in CI.

<a id="t152"></a>

### T152: The no-catalog audit

**Goal:** Show that no behavior depends on a list of SDKs, classes or
packages, views and extensions included.

- **Status:** done (2026-10-17).
- **Area:** bindings, compiler, verification.
- **Needs:** nothing.
- **Verify:** V1, V4.
- **Where:** `packages/`, `packages/compiler/test/fixtures`,
  `scripts/platform-names.ts`.

- [x] The unknown-library tests extended to views, props, events and
      children: a random library's gauge and panel, bound by rule in a
      component of the app's record, union and array types, on any host
      with a JDK; the glue compiles against React Native's headers. On
      iOS the dial still mounts with props, events and commands alone.
- [x] Every framework, class or package name in compiler, runtime, schema
      and build logic is listed, each classified as a language, ABI or
      platform anchor (or a person's example) with its reason: the
      [fixed platform anchors](design/contracts.md#fixed-platform-anchors).
- [x] A test fails when a new name appears outside that list, and when a
      row covers nothing (`scripts/platform-names.test.ts`).

**Done when:** the list is recorded in [contracts.md](design/contracts.md)
and the test runs in CI.

<a id="t153"></a>

### T153: Benchmarks against Nitro and Expo Modules

**Goal:** Measure the same operations through Lucent, Nitro, Expo Modules
and a C++ TurboModule, and publish the method with the numbers.

- **Status:** ready.
- **Area:** verification, performance.
- **Needs:** nothing.
- **Verify:** V5, V7.
- **Where:** `benchmarks/`, `apps/bare-example/src/lab/compare`,
  `scripts/bench.ts`.

- [ ] Primitive calls, strings, objects, bulk bytes, callbacks, events and
      view prop updates, in Release builds on the simulator and emulator.
- [ ] Warmup, interleaved rounds, enough samples for the tail, and the
      median, p95 and p99 reported.
- [ ] The website's benchmarks page shows them with the machine and
      versions, and P8 is checked.

**Done when:** the comparison runs in CI and the page is generated from it.

<a id="t154"></a>

### T154: Guides for every parity row, and migration guides

**Goal:** An author finds, for each parity row, a guide with code that
compiles and runs, and a migration path from Expo Modules and from Nitro.

- **Status:** waiting; needs T150.
- **Area:** docs.
- **Needs:** T150.
- **Verify:** V0, V9.
- **Where:** `apps/website/src/content/docs`, `apps/website/src/docs`,
  `benchmarks/README.md`.

- [ ] A guide per row, its samples compiled by the website check, and the
      runnable ones run in Hermes.
- [ ] Migration guides from Expo Modules and from Nitro, side by side,
      from the ports.
- [ ] The Get started guides run end to end on the simulator and emulator
      in CI.
- [ ] The website's comparison table matches [parity.md](parity.md),
      checked by `scripts/website.ts`, and a weekly job checks external
      links.
- [ ] Stale pages fixed: the package-in-app caution (`package-json.mdx`),
      the pod note (`add-native-dependencies.mdx`), and the benchmarks
      pages that say results wait for physical devices.

**Done when:** every row links a guide and the checks pass.

<a id="t155"></a>

### T155: The production-candidate gate

**Goal:** One integrated commit passes every check, and its release
candidate is documented.

- **Status:** waiting; needs every other task but T135.
- **Area:** verification, release.
- **Needs:** T100 to T157, but T135 and this task.
- **Verify:** V0 to V9, but V8.
- **Where:** the whole repository.

- [ ] Every parity row is ✅ or has a recorded decision.
- [ ] The integration run below is green in one checkout.
- [ ] Changesets, version compatibility, source maps and crash reports
      checked on the candidate.
- [ ] [limitations.md](limitations.md) reconciled with the code.
- [ ] A release-candidate report: the exact artifacts, how to reproduce
      them, and what remains unverified.

**Done when:** the report is merged. This task closes the gate.

<a id="t156"></a>

### T156: CI runs what the docs say it runs

**Goal:** Every check the docs describe runs where they say it does, and a
skipped check is reported as skipped.

- **Status:** in progress (#387, #388).
- **Area:** tooling, verification.
- **Needs:** nothing.
- **Verify:** V0, V1.
- **Where:** `.github/workflows/`, `scripts/ci-changes.ts`,
  `packages/runtime/test/run.sh`, `CONTRIBUTING.md`.

Found while rewriting [testing.md](testing.md):

- [ ] The edit-loop budget (`node scripts/bench-build.ts --check`) runs in
      CI.
- [ ] CI's Hermes build includes `hermesc`, so the kernel benchmarks
      compare with bytecode, not with source.
- [ ] The Mac Catalyst run tests get the pods they need in the `ios-test`
      shards, instead of being skipped.
- [x] `packages/runtime/test/jni/run.sh` runs in CI, plain and with
      ASan and UBSan, and fails there without a JDK rather than skip.
- [x] A change to `docs/limitations.md` alone runs the website check,
      which builds a page from it: any `docs/` file does, whose links into
      the site the check reads, as do `vercel.json` and
      `benchmarks/results/`.
- [x] The four runtime tests that call their binary directly go through
      `run_binary`, so the sanitizers check them (the executor bench too).
- [x] A check fails when the example apps' copies of the e2e cases drift
      from `node scripts/sync-examples.ts`: its `--check`, which
      `scripts/sync-examples.test.ts` runs with the unit tests.
- [ ] CONTRIBUTING.md and `devices.yml` say device runs are nightly and
      manual, as `ci.yml` has them, or pull requests run them.

**Done when:** each item is merged and the docs match the workflows.

<a id="t157"></a>

### T157: Small fixes the docs rewrite found

**Goal:** Fix the small defects and stale comments the rewrite found in
code.

- **Status:** ready.
- **Area:** compiler, runtime, tooling.
- **Needs:** nothing.
- **Verify:** V1, V3.
- **Where:** as listed.

- [ ] `lucent trace`'s summary skips instants, so `buffer.copy` bytes
      never reach the copy totals (`cli/trace.ts`).
- [ ] Autolinking always reads `.lucent/native`, while Metro honours
      `LUCENT_OUT` (`autolink/index.cjs`, `metro/native-package.cjs`).
- [ ] `debugger` is reported as "LastStatement statements" (`ir/cpp.ts`).
- [ ] Generated but unused: `registerComponents` (`ui/fabric.ts`), and
      `Mount::setEmit` outside tests.
- [ ] Stale comments: `bindgen/src/ios.ts`'s header (Swift-only
      declarations are bound now), `binding-plan.ts`'s `swiftRule`,
      `debug.h` (no `ui_debug.h`), `hooks.h` ("the Lucent lock"),
      `async.h` (await suspension), `ui/toolkits.ts`, `view.h`'s snapshot
      name, `build-graph.ts`'s example id, `jsi/convert.h`'s
      `NativeBuffer` methods, `codegen/package.json`'s description,
      `globals.d.ts` (ES2022).
- [ ] `lucent clean --cache` leaves `memo/`, `swift-modules/`, `spm/` and
      `declarations/`: remove them or say why they stay.

**Done when:** each item is fixed or recorded as intended.

## Performance budgets

Host budgets are enforced by `node scripts/bench.ts --check` and
`node scripts/bench-build.ts --check`. CI runs the first on shared
runners: it enforces the kernels and the sizes, and reports the boundary
and floor ratios, which move with the CPU (`--shared-runner`). The second
doesn't run in CI yet ([T156](#t156)). A missed budget is recorded and
decided, never quietly weakened.

| Id  | Dimension          | Gate                                                                             | Where                                 |
| --- | ------------------ | -------------------------------------------------------------------------------- | ------------------------------------- |
| P1  | Primitive calls    | A call costs within 1.25x a handwritten C++ TurboModule's host function          | `scripts/bench-floor-budgets.json`    |
| P2  | Computation        | Each kernel's speedup over JavaScript stays above its budget                     | `scripts/bench-budgets.json`          |
| P3  | Batching           | A batched call costs less than its budget times 1,000 chatty calls               | `scripts/bench-boundary-budgets.json` |
| P4  | Size and startup   | Generated objects stay within their sizes at `-O2`; installing Lucent is timed   | `scripts/bench-size-budgets.json`     |
| P5  | Edit loop          | p95 warm diagnostics under 500 ms; check and generation under 1 s                | `scripts/bench-build-budgets.json`    |
| P6  | Binary transport   | No payload copy on an owned handoff; copies and allocations counted              | the buffer tests                      |
| P7  | Teardown           | 1,000 mount and dispose cycles return owned counts to baseline                   | T120, T151                            |
| P8  | Against frameworks | Within 20% of the fastest of Nitro, Expo Modules and a TurboModule per operation | T153                                  |
| P9  | UI isolation       | Busy JavaScript and a 500 ms compute task cause no UI stall on the simulator     | T109, T151                            |

Benchmarks keep raw samples, report the median, p95 and p99, interleave
implementations after warmup, verify outputs, and rerun noisy threshold
crossings before calling a regression.

## Validation

Every task names the profiles it must pass. Build the CLI with `pnpm build`
after changing `packages/`. Check a test runner's filter before relying on
it: a filter that runs zero tests proves nothing. The numbers are the
earlier plan's, which decisions cite; V8, physical devices, left the plan.

| Profile | Checks                                                         | How to run                                                                                                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| V0      | Formatting, lint, types, whitespace                            | `pnpm check`, `git diff --check`                                                                                                |
| V1      | Unit tests and the build                                       | `pnpm build`, `pnpm test:all`                                                                                                   |
| V2      | Native output against the same code run as JavaScript          | `HERMES_DIR=~/hermes node packages/compiler/test/e2e/run.ts [case…]`, then `node scripts/sync-examples.ts` after changing cases |
| V3      | The runtime, plain and under sanitizers                        | `packages/runtime/test/run.sh`, `SANITIZE=1 CXX=g++ packages/runtime/test/run.sh`, `SANITIZE=thread`                            |
| V4      | Platform bindings and glue against real SDKs                   | The bindgen, SDK-declaration and glue-compile suites (part of `pnpm test` where the SDKs are installed; macOS for iOS)          |
| V5      | The example apps on the iOS simulator and the Android emulator | `HERMES_DIR=~/hermes node scripts/app-check.ts apps/bare-example` and `apps/expo-example`; `node scripts/device-check.ts`       |
| V6      | Fresh apps from the packed package, on each supported release  | `node scripts/smoke-install.ts`; `node scripts/window-app.ts`                                                                   |
| V7      | Performance budgets                                            | `HERMES_DIR=~/hermes node scripts/bench.ts --check`, `node scripts/bench-build.ts --check`                                      |
| V9      | The website: pages, samples, links and prose                   | `node scripts/website.ts --check` (needs Vale)                                                                                  |

The integration run, in one checkout: `node scripts/sync-examples.ts`,
`pnpm build`, `pnpm check`, `pnpm test:all`, the e2e suite, the runtime
tests plain and under ASan and TSan, SDK coverage, the website check, the
smoke install, both app checks and the bench budgets. CI's `ci` check runs
the parts a change touches on each pull request, and everything nightly.

## Former task ids

What became of each task of the earlier plan that is still linked, or was
still open on 2026-10-12. Done tasks not listed here are in
[CHANGELOG.md](../packages/lucent/CHANGELOG.md) and this file's history.

| Former id             | Title                                                   | Now                                                                             |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| <a id="t28"></a>T28   | Prove automatic binding with unknown fixture libraries  | Done (#68)                                                                      |
| <a id="t48"></a>T48   | General SDK-view JSX rules and diagnostics              | Done (#75)                                                                      |
| <a id="t49"></a>T49   | Conditional and keyed-list reactive lowering            | Done (#88)                                                                      |
| <a id="t50"></a>T50   | Yoga with explicit layout-owner boundaries              | Done (#97)                                                                      |
| <a id="t51"></a>T51   | The small Lucent UI library (issue #29)                 | Dropped: no cross-platform view library (decision 0080)                         |
| <a id="t52"></a>T52   | Wrapper ports and a views preview                       | [T150](#t150), without the device runs                                          |
| <a id="t54"></a>T54   | Measured compiler and runtime optimizations             | Done (#90, #92, #93, #100)                                                      |
| <a id="t55"></a>T55   | Native recycled and virtualized lists                   | Dropped with T51                                                                |
| <a id="t56"></a>T56   | Native gestures and frame-driven animation              | Dropped with T51; interop with gesture and animation libraries is [T121](#t121) |
| <a id="t59"></a>T59   | Media pipelines, high-rate streams and executors        | [T108](#t108), [T109](#t109), [T150](#t150)'s `lucent-frames`                   |
| <a id="t60"></a>T60   | Headless, background and other native targets           | [T130](#t130) to [T137](#t137)                                                  |
| <a id="t61"></a>T61   | The editor, doctor, SDK and debugging workflows         | Done (#98, #99, #102, #103, #104)                                               |
| <a id="t62"></a>T62   | The distribution and supported-version matrix           | [T140](#t140), [T141](#t141), [T145](#t145)                                     |
| <a id="t63"></a>T63   | The no-catalog audit                                    | [T152](#t152)                                                                   |
| <a id="t64"></a>T64   | Lifetime, concurrency and Fabric stress                 | [T151](#t151), without the device runs                                          |
| <a id="t65"></a>T65   | Physical-device performance budgets                     | [T153](#t153) on the simulator and emulator; device runs dropped                |
| <a id="t66"></a>T66   | User documentation and migration examples               | [T154](#t154)                                                                   |
| <a id="t67"></a>T67   | The production-candidate gate                           | [T155](#t155)                                                                   |
| <a id="t68"></a>T68   | Pilot packages for independent authors                  | Dropped: maintainer-only (decision 0080)                                        |
| <a id="t69"></a>T69   | Pilot evidence                                          | Dropped: maintainer-only (decision 0080)                                        |
| <a id="t70"></a>T70   | The final capability and readiness assessment           | Dropped: its report is part of [T155](#t155)                                    |
| <a id="t71"></a>T71   | Native object references as view props                  | [T120](#t120)                                                                   |
| <a id="t72"></a>T72   | Zero-copy bytes at the boundary                         | [T108](#t108)                                                                   |
| <a id="t73"></a>T73   | Interop handles                                         | [T107](#t107)                                                                   |
| <a id="t74"></a>T74   | Callback executors and stream backpressure              | [T109](#t109)                                                                   |
| <a id="t75"></a>T75   | A window of stable React Native and Expo releases       | [T140](#t140)                                                                   |
| <a id="t76"></a>T76   | App-delegate and Activity integration hooks             | [T110](#t110)                                                                   |
| <a id="t77"></a>T77   | Classes the OS instantiates, and typed package Kotlin   | [T131](#t131), [T143](#t143)                                                    |
| <a id="t78"></a>T78   | UIKit components with a view-controller root            | [T122](#t122); the `Fragment` root is [T131](#t131)                             |
| <a id="t79"></a>T79   | C and C++ dependencies: C++ extensions and prefab       | [T142](#t142)                                                                   |
| <a id="ta26"></a>TA26 | Lay out the slot after a native-only move on iOS        | Done (#77)                                                                      |
| <a id="ta32"></a>TA32 | Read Swift packages and the iOS target from the project | Done (#82)                                                                      |
| <a id="ta33"></a>TA33 | Bind the remaining Swift shapes                         | Done (#83)                                                                      |
| <a id="ta35"></a>TA35 | A package's own pods in an Expo app                     | [T141](#t141)                                                                   |
| <a id="ta36"></a>TA36 | The gaps four reference ports need                      | Done (#128, #129); the ports are [T150](#t150)'s                                |
| <a id="ta37"></a>TA37 | The language gaps the review found                      | Done (#149); platform-file classes are [T106](#t106)                            |
| <a id="ta41"></a>TA41 | Name reference cycles in debug builds                   | Done (#184, #185, #186); the simulator check is [T151](#t151)'s                 |
| <a id="ta42"></a>TA42 | `RangeError` on stack exhaustion                        | Done (#173)                                                                     |
| <a id="ta44"></a>TA44 | `WeakMap` and `WeakSet` keyed by instances              | Done (#170)                                                                     |
| <a id="ta45"></a>TA45 | Each example's evidence, stated from the record         | [T150](#t150)                                                                   |
| <a id="ta46"></a>TA46 | A web target for shared modules                         | [T144](#t144)                                                                   |

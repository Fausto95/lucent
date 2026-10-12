# Lucent tasks

The open work, task by task, grouped by the gate each task closes.
[ROADMAP.md](../ROADMAP.md) says why and in what order.
[parity.md](parity.md) is the capability matrix against Nitro and Expo
Modules that the gates come from. Decisions are in
[decisions/](decisions/), and finished work is in
[CHANGELOG.md](../packages/lucent/CHANGELOG.md), by release.

Tasks live here rather than in GitHub issues, so the commit that does the
work updates its task. A commit that finishes, changes or adds a task
updates its entry and the table below in the same commit. A new task takes
the next free id in its gate's range and never reuses one.

The plan was rewritten from scratch on 2026-10-12
([decision 0080](decisions/0080-the-plan-is-rewritten-for-parity-with-nitro-and-expo-modules.md)).
Ids start at T100. Ids below T100, and `TA` ids, belong to the earlier
plan: read them in this file at commit `1f72821d`. [Former task ids](#former-task-ids)
says what became of each one that is still linked or was still open.

## Status

| Task                     | Title                                                    | State                                                             |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| **Module parity**        |                                                          |                                                                   |
| [T100](#t100)            | Typed arrays and `DataView`                              | ready                                                             |
| [T101](#t101)            | Keep `null` apart from `undefined` everywhere            | ready                                                             |
| [T102](#t102)            | Recursive union types, for JSON-shaped values            | ready                                                             |
| [T103](#t103)            | Promise chaining and combinators                         | ready                                                             |
| [T104](#t104)            | Timers and `queueMicrotask`                              | ready                                                             |
| [T105](#t105)            | Web APIs that shared code uses                           | ready                                                             |
| [T106](#t106)            | Language gaps module code meets                          | ready                                                             |
| [T107](#t107)            | Native objects: memory pressure and native handles       | in progress (#175, #180, #183 merged, as T73)                     |
| [T108](#t108)            | Platform memory as JavaScript bytes, without copying     | in progress (#163, #165, #167, #168 merged, as T72)               |
| [T109](#t109)            | Executors for platform callbacks                         | in progress (#181, #182, #187, #197 merged, as T74)               |
| [T110](#t110)            | App-delegate and Activity events                         | ready (decision 0076)                                             |
| [T111](#t111)            | The app's own native needs                               | ready                                                             |
| [T112](#t112)            | SDK shapes Lucent still refuses                          | ready                                                             |
| **View parity**          |                                                          |                                                                   |
| [T120](#t120)            | Instances of exported classes as view props              | ready (decision 0075)                                             |
| [T121](#t121)            | React Native's view props and a host ref on components   | ready                                                             |
| [T122](#t122)            | UIKit components with a view-controller root             | ready                                                             |
| [T123](#t123)            | Native objects and helpers in SwiftUI and Compose bodies | waiting; needs T120                                               |
| **Execution modes**      |                                                          |                                                                   |
| [T130](#t130)            | A native root: module code with no JavaScript runtime    | ready; its first step is a decision                               |
| [T131](#t131)            | Android classes the OS instantiates, written in Lucent   | waiting; needs T130                                               |
| [T132](#t132)            | iOS background execution                                 | waiting; needs T110, T130                                         |
| [T133](#t133)            | iOS app extensions and widgets                           | waiting; needs T130                                               |
| [T134](#t134)            | Calls from worklet runtimes                              | ready; its first step is a decision                               |
| [T135](#t135)            | JavaScript tasks from background entry points            | blocked: a decision on whether Lucent offers it; needs T131, T132 |
| **Distribution**         |                                                          |                                                                   |
| [T140](#t140)            | A window of stable React Native and Expo releases, run   | in progress (#190, #191, #194, #195, #200 merged, as T75)         |
| [T141](#t141)            | Builds from Xcode, and a package's pods in Expo apps     | ready                                                             |
| [T142](#t142)            | C++ libraries, extension callbacks and prefab            | ready                                                             |
| [T143](#t143)            | Typed Kotlin and Java sources in packages                | ready                                                             |
| [T144](#t144)            | A web target for shared modules                          | ready (decision 0077)                                             |
| **Production candidate** |                                                          |                                                                   |
| [T150](#t150)            | Reference ports for each parity row                      | ready for each port whose needs are done                          |
| [T151](#t151)            | Lifetime, concurrency and Fabric stress validation       | ready                                                             |
| [T152](#t152)            | The no-catalog audit                                     | ready                                                             |
| [T153](#t153)            | Benchmarks against Nitro and Expo Modules                | ready                                                             |
| [T154](#t154)            | Guides for every parity row, and migration guides        | waiting; needs T150                                               |
| [T155](#t155)            | The production-candidate gate                            | waiting; needs every other task but T135                          |

## Gates

A gate closes when its tasks are done and its closing check passes on the
integrated result.

| Gate                 | Closes when                                                                                                                                         | Closing task |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Module parity        | Every module row of [parity.md](parity.md) is ✅: the values, objects, threads and app events a Nitro or Expo module offers                         | T112         |
| View parity          | Every view row is ✅: props of any type, React Native's view props, controller roots and native objects in toolkit bodies                           | T123         |
| Execution modes      | Lucent code runs where the platform calls it: with no JavaScript, in background tasks, services, extensions and worklet runtimes                    | T133         |
| Distribution         | Fresh apps on each supported release build and run; a package builds from Xcode and Gradle alone, with C++ libraries, its own Kotlin and on the web | T140         |
| Production candidate | Ports prove each row, stress and budgets pass, the docs cover every row, and the integration run is green                                           | T155         |

## Requirements

These hold for every task. A task is not done by weakening one of them.

| Requirement          | What it means                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No curated catalog   | APIs come from the installed SDKs and resolved dependencies. No list of SDKs, APIs, views or class names decides behavior. A small fixed platform surface (JSI, Fabric, JNI, ARC, app lifecycle) is allowed and named in the audit. |
| Mechanisms in core   | Core provides mechanisms: entry points, executors, buffers, lifecycle events. An API such as a background-task scheduler or a notifications module is a Lucent package built on them, never a core special case.                    |
| JavaScript semantics | [semantics.md](semantics.md) is the contract. Unsupported code fails with an actionable `LUCENT` diagnostic, never with invalid native code or a compiler crash.                                                                    |
| Thread ownership     | JSI values stay on their runtime's thread; other threads hold `Host` ids. The main thread never waits behind module code.                                                                                                           |
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
- **Where:** the code it changes.

The checklist is the acceptance criteria, and **Done when** closes the
task. A task is checked off only when its criteria pass on the integrated
result.

## Module parity

<a id="t100"></a>

### T100: Typed arrays and `DataView`

**Goal:** Every JavaScript typed array and `DataView` works in Lucent code
and crosses the boundary, so audio, sensor and model modules pass samples
as Expo modules do.

- **Status:** ready.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V8.
- **Where:** `runtime/cpp/lucent` (`bytes.h` and a typed-array header),
  `emit/builtins.ts`, `jsi/convert.*`, `lib/sdk`.

Today only `Uint8Array` and `ArrayBuffer` exist; `new Float32Array(n)` is
refused with LUCENT2002, and `DataView` too.

- [ ] `Int8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`,
      `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`,
      `BigInt64Array` and `BigUint64Array`, with the methods `Uint8Array`
      has, as views over one `ArrayBuffer` at any byte offset, with
      JavaScript's conversion and clamping on write.
- [ ] `DataView`, every getter and setter, both byte orders.
- [ ] The boundary treats them as `Uint8Array`: copied by default, lent to
      a synchronous export that only reads, moved on return when nothing
      else holds the buffer.
- [ ] A typed view of a `NativeBuffer`'s bytes inside `withRead` and
      `withWrite`.
- [ ] e2e: `typed-arrays`, `data-view`; semantics and the website's
      language page list them.

**Done when:** the cases pass natively and as JavaScript, and no typed
array is listed as refused.

<a id="t101"></a>

### T101: Keep `null` apart from `undefined` everywhere

**Goal:** `null` and `undefined` stay apart wherever JavaScript keeps them
apart, as Nitro's optionals and Expo's `ValueOrUndefined` do.

- **Status:** ready.
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `jsi/convert.h`, `core.h` (`Opt`), `emit/bindings.ts`.

Today they are apart for arguments, setter values and object fields only.
Inside arrays, maps, sets, records, tuples, callback results and promise
values, `T | undefined` also takes `null`, and `T | null` takes
`undefined`.

- [ ] Each container, callback result and promise value keeps the state
      JavaScript gave it, both ways, through `Opt`'s three states.
- [ ] A value of the wrong one of the two is a `TypeError` naming its path,
      as a wrong argument is.
- [ ] e2e: `null-undefined-nested`, covering each container both ways.

**Done when:** the known gap is gone from `apps/website/src/docs/language.ts`
and [limitations.md](limitations.md).

<a id="t102"></a>

### T102: Recursive union types, for JSON-shaped values

**Goal:** A recursive union alias compiles and crosses, so a module takes
and returns untyped data, as Nitro's `AnyMap` and Expo's dictionaries do:

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
```

- **Status:** ready.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `types.ts`, `emit/`, `jsi/convert.h`.

Today the compiler overflows its stack on that alias (`RangeError:
Maximum call stack size exceeded`), a crash instead of a diagnostic.

- [ ] First, a regression test: the alias gives a `LUCENT` diagnostic, not
      a crash (`diagnostics.test.ts`).
- [ ] A recursive union lowers to a variant that holds its recursive
      members by reference. `typeof`, `Array.isArray` and `in`-free
      narrowing work on it.
- [ ] It crosses both ways at any depth, under the stack check, and
      `JSON.parse(text) as Json` fills it.
- [ ] The guide shows platform dictionaries (`NSDictionary`, `Bundle`,
      `JSONObject`) reaching it through their JSON serializers.
- [ ] e2e: `json-values`.

**Done when:** the alias above compiles, crosses and round-trips through
`JSON.parse` and `JSON.stringify`, natively and as JavaScript.

<a id="t103"></a>

### T103: Promise chaining and combinators

**Goal:** Promise code from ordinary TypeScript modules compiles: `then`,
`catch`, `finally` and every combinator.

- **Status:** ready.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `async.h`, `emit/builtins.ts`, `lib/sdk`.

Today `then`, `catch` and `finally` give LUCENT1003 ("use await"), and so
do `Promise.race` and `Promise.any`. `Promise.allSettled` fails on
`PromiseRejectedResult` (LUCENT2002).

- [ ] `then`, `catch` and `finally`, with JavaScript's microtask order.
- [ ] `Promise.race`, `Promise.any` (with `AggregateError`) and
      `Promise.allSettled` (with `PromiseSettledResult`).
- [ ] e2e: `promise-chains`, `promise-combinators`, which compare the order
      of settled callbacks with JavaScript's.

**Done when:** none of them is refused.

<a id="t104"></a>

### T104: Timers and `queueMicrotask`

**Goal:** `setTimeout`, `setInterval` and `queueMicrotask` work in module
code, on the context that calls them.

- **Status:** ready.
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `execution.h`, `hooks.h`, `lib/globals.d.ts`.

Today only `delay(ms, signal)` from `lucent:core` exists; `setTimeout` is
not declared.

- [ ] `setTimeout`, `clearTimeout`, `setInterval` and `clearInterval` on
      the calling context (a package's actor, the main thread, an
      executor), with HTML's clamping and ordering rules where JavaScript
      states them.
- [ ] `queueMicrotask` on the calling context's microtask queue.
- [ ] Timers a module started are cleared at teardown, as `onDestroy`
      hooks run.
- [ ] e2e: `timers`, `microtasks`.

**Done when:** the cases pass natively and as JavaScript.

<a id="t105"></a>

### T105: Web APIs that shared code uses

**Goal:** Code shared between platforms encodes text, base64 and URLs, and
makes random values, without per-platform calls.

- **Status:** ready.
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `runtime/cpp/lucent`, `runtime/cpp/third_party`,
  `lib/globals.d.ts`.

Today `TextEncoder`, `atob`, `URL` and `crypto` are not declared; module
code uses `utf8Encode` from `lucent:core` or the platform's own APIs.

- [ ] `TextEncoder` and `TextDecoder` (UTF-8, `fatal`, `ignoreBOM`).
- [ ] `atob` and `btoa`.
- [ ] `URL` and `URLSearchParams`, by WHATWG's parser (a vendored parser
      in `third_party`, with its license).
- [ ] `crypto.getRandomValues` and `crypto.randomUUID`, from the
      platform's secure generator.
- [ ] Each is exact or refused: an option it doesn't support is a
      diagnostic.
- [ ] e2e: `text-encoding`, `base64`, `urls`, `random-values`.

**Done when:** the cases pass natively and as JavaScript.

<a id="t106"></a>

### T106: Language gaps module code meets

**Goal:** Lift the refusals that ordinary module code meets most.

- **Status:** ready.
- **Area:** compiler, runtime.
- **Needs:** nothing.
- **Verify:** V2, V3, V4.
- **Where:** `ir/lower.ts`, `emit/`.

- [ ] Object rest in destructuring (LUCENT1004 today).
- [ ] Spread arguments into functions with rest parameters, and from
      tuples (LUCENT1007).
- [ ] `new Error(message, { cause })` and an error's `cause`, which crosses
      to JavaScript.
- [ ] `JSON.stringify` with a replacer and an indent.
- [ ] `Array.prototype.flat` and `copyWithin`.
- [ ] The ES2025 `Set` methods (`union`, `intersection`, `difference`,
      `symmetricDifference`, `isSubsetOf`, `isSupersetOf`,
      `isDisjointFrom`).
- [ ] `for await…of` over async generators and `Channel`, and async
      generators themselves.
- [ ] A class declared in the declaration file of platform files
      (`export declare class`), with each platform file implementing it.
- [ ] An e2e case for each.

**Done when:** each item passes natively and as JavaScript, and the website
lists none of them as refused.

<a id="t107"></a>

### T107: Native objects: memory pressure and native handles

**Goal:** An exported class tells JavaScript's garbage collector how much
native memory an instance holds, and native pointers reach other native
code as typed handles.

- **Status:** in progress: `NativeHandle`'s type and its JSI conversion are
  merged (#175, #180, #183, as T73).
- **Area:** runtime, bindings.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V5.
- **Where:** `handle.h`, `jsi/convert.cpp`, `lib/sdk/ios.d.ts`,
  `lib/sdk/android.d.ts`.

- [ ] Memory pressure: a decision on how a class states its native size
      (a member it declares, read when an instance crosses and when it
      changes), then `setExternalMemoryPressure` on its JavaScript object,
      as `NativeBuffer`s already get.
- [ ] Platform makers for `NativeHandle`: `retainedHandle(obj)` in
      lucent:ios (a +1 retain, `CFRetain` for CF types), and one from a
      `HardwareBuffer` or a direct `ByteBuffer` in lucent:android.
      `release()` once, from either side.
- [ ] e2e: `opaque-values` (round trips, identity through a record, a
      reload) and `native-handles` (host JSI harness: retain, release from
      each side, the finalizer counted as a leak in debug builds).
- [ ] Semantics: an "Interop" section.

**Done when:** a host test shows the collector seeing an instance's native
size, and the handle cases pass.

<a id="t108"></a>

### T108: Platform memory as JavaScript bytes, without copying

**Goal:** A camera frame, an image or a file's bytes reach JavaScript as an
`ArrayBuffer` without a copy, on both platforms.

- **Status:** in progress: returned buffers move, a synchronous export
  reads JavaScript's bytes in place, and Android adopts a direct
  `ByteBuffer` (#163, #165, #167, #168, as T72).
- **Area:** runtime, bindings.
- **Needs:** nothing.
- **Verify:** V2, V4, V5, V6, V8.
- **Where:** `buffer.h`, `platform/`, `lib/sdk/ios.d.ts`,
  `lib/sdk/android.d.ts`.

- [ ] lucent:ios adopts an `NSData`'s bytes as an `ArrayBuffer`, retained
      until released.
- [ ] lucent:ios adopts a `CVPixelBuffer` plane: its base address is
      locked for the buffer's life, read-only unless asked, then unlocked
      and released once. `withPixelBytes` stays as the copying form.
- [ ] lucent:android adopts a `HardwareBuffer` (API 26 and later, behind
      `available`), through the NDK's `AHardwareBuffer`.
- [ ] Semantics: the boundary's copy rule names each exception. The
      C-BUFFER contract records the adoptions.

**Done when:** each adoption has a host test, and a simulator or emulator
run shows no copy of the payload (the buffer's stats count none).

<a id="t109"></a>

### T109: Executors for platform callbacks

**Goal:** A frame delegate, a sensor listener or a socket callback runs on
a serial executor of its own, never queued behind JavaScript calls that
hold its package's lock.

- **Status:** in progress: `Channel` with its three policies and
  `subscribe`, and the runtime's `ExecutorContext`, are merged (#181,
  #182, #187, #197, as T74). Decided as
  [0078](decisions/0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md).
- **Area:** compiler, runtime, bindings.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V5, V8.
- **Where:** `lib/sdk/thread.d.ts`, `execution.h`, `emit/`, `analysis/`.

- [ ] `executor(label)` from `lucent:thread`: a serial dispatch queue on
      iOS and a single-thread `Executor` on Android, which platform APIs
      that take one take as it is.
- [ ] `on(exec, delegate)` and `on(exec, closure)` put code on it where it
      is handed to the platform. The glue enters the executor's context
      directly.
- [ ] The compiler checks executor code as it checks a compute task, but
      allows native code of any thread or of the executor's own. Module
      state, JavaScript callbacks, promises and awaits are refused with the
      cause path. Members only executor code touches are the executor's.
- [ ] Executors produce into channels, and post `EventEmitter` events to
      JavaScript. The guide says which to use for what.
- [ ] Trace: each channel's waits, depth and drops, and an executor's
      spans beside its actor's.
- [ ] Bench (host): synthetic 1080p frames at 60 Hz through an executor
      into a `latest` channel, while a 500 ms synchronous JavaScript call
      holds the package's actor. The executor thread waits on no actor,
      drops are counted, and the p99 handler latency is reported.
- [ ] Semantics: the concurrency model gains executors and channels.

**Done when:** the bench shows no actor wait on the executor thread, and a
simulator run delivers camera frames through an executor.

<a id="t110"></a>

### T110: App-delegate and Activity events

**Goal:** Module code receives what only the app delegate and the Activity
receive, through the subscriber
[0076](decisions/0076-an-app-delegate-and-activity-subscriber.md)
describes.

- **Status:** ready.
- **Area:** iOS and Android hosts, runtime, tooling.
- **Needs:** nothing.
- **Verify:** V2, V4, V5, V6, V7.
- **Where:** `platform/ios_ui.mm`, `lifecycle.h`,
  `platform/android_activity.cpp`, `runtime/native`, `cli/init.ts`,
  `app.plugin.js`.

- [ ] iOS, through `onAppEvent`, typed: `openURL` (url, options),
      `userActivity` (type, url, payload), `pushToken` (`Uint8Array`) and
      its failure, `remoteNotification` (payload; the handler answers the
      fetch result through a promise with a deadline, and answers from
      several modules merge as Expo merges them), `backgroundURLSession`
      (identifier, and a completion the module calls) and `shortcutItem`.
- [ ] The URL, user activity or shortcut that launched the app is kept
      until the first subscriber takes it.
- [ ] Android, through `onActivityEvent`: `backPressed` (a handler may
      consume it), `userLeaveHint`, `configurationChanged` and `keyUp`,
      beside `newIntent`.
- [ ] In an Expo app, an `ExpoAppDelegateSubscriber` and a
      `ReactActivityLifecycleListener` the build declares. In a bare app,
      `lucent init` adds one forwarding line per delegate method,
      `lucent doctor` checks them, and `lucent build` names a missing one.
- [ ] `lucent.json` `android.mainActivity` attributes
      (`supportsPictureInPicture`, `configChanges`, `launchMode`), merged
      by the manifest rules; the Expo plugin writes them.
- [ ] Tests: `lifecycle_test.cpp` merges answers. The example apps open a
      deep link and read a push token on the simulator and emulator (a
      fake registration exercises the token path).

**Done when:** both example apps receive each event in their device check.

<a id="t111"></a>

### T111: The app's own native needs

**Goal:** Modules in the app itself declare their native needs, as a
package's do, without becoming a package.

- **Status:** ready.
- **Area:** compiler, tooling.
- **Needs:** nothing.
- **Verify:** V2, V6, V7.
- **Where:** `package-config.ts`, `packages.ts`, `app.plugin.js`.

Today only dependency packages' `lucent.json` is read
(`lucentPackages` visits dependencies, never the app's root). The app's own
modules get Android permissions inferred from `@RequiresPermission`, and
nothing else.

- [ ] The app's root `lucent.json`, with the package schema, read and
      merged like a package's: Info.plist keys, entitlements, pods, Gradle
      dependencies, Android permissions and components, native sources,
      extensions.
- [ ] The build reruns when it changes, as it does for packages.
- [ ] `lucent new module --template sdk-ios-android` writes the keys its
      sample needs into it.
- [ ] Tests: a fixture app whose own module needs an Info.plist key and a
      Gradle dependency, in a fresh bare and Expo app (smoke install).

**Done when:** an app's own module declares everything a package can.

<a id="t112"></a>

### T112: SDK shapes Lucent still refuses

**Goal:** Bind the native shapes that common libraries use and Lucent
still refuses, so the module gate closes on real SDKs.

- **Status:** ready.
- **Area:** bindings, compiler.
- **Needs:** nothing.
- **Verify:** V2, V5.
- **Where:** `bindgen/src/binding-plan.ts`, `emit/native.ts`,
  `emit/objc-subclass.ts`, `emit/swift.ts`, `emit/kotlin.ts`.

- [ ] `WeakRef` to an SDK object, and `WeakMap` keyed by one, for delegate
      back references.
- [ ] Optional closures and tuples; optionals, C structs and Objective-C
      enums inside collections.
- [ ] Members of protocols with associated types, where the conforming
      type fixes them.
- [ ] Async and throwing property requirements, and async initializers as
      constructors.
- [ ] A Lucent `async` method implementing a Kotlin `suspend` member, so a
      Lucent class implements a Kotlin interface with one (`CoroutineWorker`
      needs it in T131).
- [ ] Overriding Objective-C properties in a Lucent subclass.
- [ ] `lucent sdk coverage` for UIKit, Foundation, AVFoundation, StoreKit,
      CryptoKit and AndroidX recorded before and after, in this task.

**Done when:** each item has a binding test on its platform, and the
recorded coverage shows the change. This task closes the module gate.

## View parity

<a id="t120"></a>

### T120: Instances of exported classes as view props

**Goal:** `<VideoView player={player} />` works, as Nitro's Hybrid Object
props and Expo's shared-object props do, per
[0075](decisions/0075-instances-of-exported-classes-as-view-props.md).

- **Status:** ready.
- **Area:** views, runtime, compiler.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V6.
- **Where:** `ui/contract.ts`, `ui/transport.ts`, `rn/LucentViewValues*`,
  `runtime/js/views.js`.

- [ ] Transport (C-VIEW): the prop crosses Fabric as the instance's id in
      its host plus the runtime id. A value that is not an instance of the
      declared class is a `TypeError` at render.
- [ ] The mount resolves the id to the instance on the main thread at
      commit, and holds it while it shows it. An id of a freed instance or
      of another runtime is reported and reads as missing.
- [ ] Members only main-thread code touches are the main thread's. A member
      module code also touches is refused where a view uses it, naming both
      uses.
- [ ] Arrays of instances, and `T | null`.
- [ ] e2e: `view-ref-props` (host JSI harness: an instance prop set,
      replaced, nulled and freed). 1,000 mount and unmount cycles return
      the owned counts to baseline (P7).

**Done when:** the case passes and the bare example's players screen uses an
instance prop.

<a id="t121"></a>

### T121: React Native's view props and a host ref on components

**Goal:** A Lucent component takes the view props every React Native view
takes, as Expo views do.

- **Status:** ready.
- **Area:** views.
- **Needs:** nothing.
- **Verify:** V2, V6.
- **Where:** `runtime/js/views.js`, `ui/proxy.ts`, the generated
  component types.

Today the proxy passes `style` and the component's own props only, so
`testID`, `nativeID`, `accessibilityLabel`, `onLayout` and the rest are
dropped.

- [ ] The proxy passes React Native's view props through to the host view,
      and the component's type accepts them (`ViewProps`, minus `children`
      unless the component declares it).
- [ ] The ref exposes the host's `measure`, `measureInWindow` and
      `setNativeProps`-free methods beside the component's commands, with
      no name clash allowed (a diagnostic).
- [ ] Tests: `testID` reaches the native view, `onLayout` fires, and an
      accessibility label is read on the simulator and emulator.

**Done when:** a component accepts every documented React Native view prop.

<a id="t122"></a>

### T122: UIKit components with a view-controller root

**Goal:** A component's iOS branch returns a `UIViewController`, such as
`AVPlayerViewController`, contained the way the SwiftUI host is.

- **Status:** ready.
- **Area:** views, iOS host.
- **Needs:** nothing.
- **Verify:** V2, V5, V6.
- **Where:** `ui/roots.ts`, `rn/LucentComponentView.mm`.

- [ ] A branch returning a `UIViewController` is a component. The host
      contains it (`addChildViewController:`, the content view, the
      parent's traits, no safe-area insets) and releases it on dispose.
- [ ] Sizing: style or flex only. `preferredContentSize` changes mark the
      content for `invalidateSize`.
- [ ] Commands present from the contained controller. A modal it shows
      outlives a commit and is dismissed on dispose.
- [ ] A spike: `AVPlayerViewController` with a Lucent `AVPlayer` enters
      and leaves fullscreen and picture in picture, survives a recycle,
      and reports its delegate's events as component events.

**Done when:** the spike runs on the simulator in CI.

<a id="t123"></a>

### T123: Native objects and helpers in SwiftUI and Compose bodies

**Goal:** Toolkit bodies take what UIKit and Android bodies take: instance
props, and helper functions with children and bindings.

- **Status:** waiting; needs T120.
- **Area:** views, compiler.
- **Needs:** T120.
- **Verify:** V2, V5, V6.
- **Where:** `emit/swiftui.ts`, `ui/compose.ts`.

- [ ] An instance prop reaches a SwiftUI or Compose body, observed on the
      main thread.
- [ ] Helper view functions take toolkit values, children and bindings.
- [ ] Tests on the simulator and emulator.

**Done when:** the views limitations list neither restriction. This task
closes the view gate.

## Execution modes

<a id="t130"></a>

### T130: A native root: module code with no JavaScript runtime

**Goal:** Lucent code runs when the platform starts the app for a
background task, a push or an extension, before or without any JavaScript
runtime.

- **Status:** ready; its first step is a decision.
- **Area:** runtime, compiler.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V5.
- **Where:** `jsi/host.h`, `hooks.h`, `scheduler.h`, `emit/identity.ts`,
  `emit/bindings.ts`.

Today module state belongs to the process, but a module's top level runs
when a JavaScript runtime installs Lucent, and there is no native way in.

- [ ] A decision: when a module's top level runs and when its state
      resets once native roots exist. For example, once per process, at
      first use from JavaScript or from a native entry point, and reset by
      a reload only when no native root holds it.
- [ ] A native root: the runtime starts its actors and contexts with no
      `Host`. A JavaScript `Host` that installs later sees the same module
      state.
- [ ] Native entry points: generated C functions that run a module
      function on its actor, for the glue of T131, T132 and T133 to call.
- [ ] `lucent.json` `launch`: modules created at app launch, before the
      first frame, so they can register what the OS requires by then.
- [ ] Without a runtime, a call that needs one (a JavaScript callback, a
      `JSValue`) throws a typed error. An event with no listener is
      dropped.
- [ ] Tests: a host test calls an entry point with no `Host`, then
      attaches one that reads the state; `scheduler_test.cpp` covers
      startup with no runtime.

**Done when:** an entry point runs module code with no JavaScript runtime,
on host, simulator and emulator.

<a id="t131"></a>

### T131: Android classes the OS instantiates, written in Lucent

**Goal:** A `Service`, `BroadcastReceiver`, WorkManager `Worker`,
`AppWidgetProvider`, `TileService`, `FirebaseMessagingService` or
`Fragment` is a Lucent class.

- **Status:** waiting; needs T130.
- **Area:** Android host, compiler.
- **Needs:** T130; T112 for `CoroutineWorker`.
- **Verify:** V2, V5, V6.
- **Where:** `emit/java.ts`, `native-build-files.ts`, `package-config.ts`.

Today `android.components` declares a service, receiver or provider, but
its class must be Java or Kotlin the package ships.

- [ ] A Lucent class extending an OS-instantiated base gets a generated
      Java subclass with the constructor the OS calls (no arguments, or
      `Context` and `WorkerParameters` for a `Worker`). It creates its
      Lucent instance on first use, on the calling thread, through the
      native root.
- [ ] `lucent.json` `android.components[].class` names the Lucent class,
      and the manifest's `android:name` is the generated class.
      `foregroundServiceType`, intent filters and permissions work as
      today.
- [ ] A `Fragment` shown through a `FragmentActivity`'s manager. When the
      OS recreates it, a new Lucent instance is made and the module is
      told.
- [ ] Tests on the desktop JVM host (`test/fake-android.ts`): an
      OS-style instantiation. On the emulator: a periodic `Worker` that
      runs with the app in the background, and a foreground
      `MediaSessionService` that survives the Activity's recreation.

**Done when:** both emulator fixtures run in CI.

<a id="t132"></a>

### T132: iOS background execution

**Goal:** Background tasks, background URL sessions and silent pushes run
Lucent code, with no JavaScript, as `expo-background-task` and
`expo-notifications` tasks do.

- **Status:** waiting; needs T110, T130.
- **Area:** iOS host, runtime, tooling.
- **Needs:** T110, T130.
- **Verify:** V2, V5, V6.
- **Where:** `platform/`, `runtime/native`, `app.plugin.js`.

- [ ] A `launch` module registers `BGTaskScheduler` handlers before the
      app finishes launching. The handler runs Lucent code through the
      native root.
- [ ] The task's expiration aborts an `AbortSignal` the handler holds, and
      the handler reports completion.
- [ ] `backgroundURLSession` and `remoteNotification` (T110) relaunch the
      process into the native root when it isn't running.
- [ ] `UIBackgroundModes` and `BGTaskSchedulerPermittedIdentifiers` come
      from `lucent.json` `ios.infoPlist`, and `lucent build` names a
      missing one when the code registers an identifier.
- [ ] Tests: the simulator runs a task through a debug-build trigger,
      since the scheduler doesn't launch tasks on the simulator.

**Done when:** the trigger runs a registered task's Lucent handler on the
simulator in CI.

<a id="t133"></a>

### T133: iOS app extensions and widgets

**Goal:** A package's Lucent code runs in an app extension: a widget with
a SwiftUI body, a notification service extension or a share extension.

- **Status:** waiting; needs T130.
- **Area:** iOS host, compiler, tooling.
- **Needs:** T130.
- **Verify:** V2, V5, V6, V7.
- **Where:** `native-build-files.ts`, `emit/swiftui.ts`,
  `emit/swift-proxy.ts`, `app.plugin.js`, `runtime/native`.

- [ ] A decision: how a package declares an extension target in
      `lucent.json`, and how a Lucent class becomes its principal class or
      its widget (`TimelineProvider` through the Swift proxy, the body
      through SwiftUI JSX).
- [ ] The extension links the Lucent runtime and the package's modules
      without React Native, through a second native build of the same
      program.
- [ ] APIs unavailable to extensions are refused in extension code, from
      their availability attributes.
- [ ] The Expo plugin adds the target. A bare app gets the target from a
      CLI command.
- [ ] App Groups: the entitlement from `lucent.json`, so the app and its
      extension share storage.
- [ ] Tests: a widget fixture and a notification service fixture build
      and run on the simulator.

**Done when:** both fixtures run on the simulator in CI. This task closes
the execution-modes gate.

<a id="t134"></a>

### T134: Calls from worklet runtimes

**Goal:** Worklets call Lucent modules, as Nitro objects and Expo modules
work on `react-native-worklets` runtimes.

- **Status:** ready; its first step is a decision.
- **Area:** runtime, tooling.
- **Needs:** nothing.
- **Verify:** V2, V4, V6.
- **Where:** `jsi/host.h`, `rn/LucentModule.cpp`, `runtime/js`.

- [ ] A decision: how Lucent installs on a worklet runtime, and what a
      call from one does (a synchronous export on that runtime's thread
      under its package's lock, async results and callbacks posted to that
      runtime's scheduler, instances shared across runtimes).
- [ ] A `Host` per worklet runtime, torn down with it.
- [ ] Tests: a host test with two runtimes; the example app calls a
      synchronous export from a UI-runtime worklet on the simulator and
      emulator.

**Done when:** the example app's worklet call runs in CI.

<a id="t135"></a>

### T135: JavaScript tasks from background entry points

**Goal:** A background entry point runs a JavaScript function, as
`expo-task-manager` does, for apps that keep task logic in JavaScript.

- **Status:** blocked: a decision on whether Lucent offers it, since Lucent
  code already runs natively there.
- **Area:** iOS and Android hosts, runtime.
- **Needs:** T131, T132.
- **Verify:** V2, V6.
- **Where:** `runtime/native`, `runtime/js`.

- [ ] The decision.
- [ ] If accepted: React Native started headless from the entry point
      (Android's `HeadlessJsTaskService`, a background launch on iOS), and
      the JavaScript function run with the event.

**Done when:** the decision is recorded, and if accepted, a fixture runs on
both platforms.

## Distribution

<a id="t140"></a>

### T140: A window of stable React Native and Expo releases, run

**Goal:** Apps on every release in the window build and run, and the
templates and example apps use a stable release.

- **Status:** in progress: the window is React Native 0.85 to 0.87 and Expo
  SDK 56 and 57, with 0.88 and SDK 58 as the prerelease lane
  ([0074](decisions/0074-a-window-of-stable-react-native-and-expo-releases.md),
  [0079](decisions/0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md)).
  `lucent doctor` checks it, the build identity carries the React Native
  release, CI compiles against each release's headers, and window.yml
  builds ten fresh apps nightly, all green on 2026-10-12 (#190, #191,
  #194, #195, #200, as T75).
- **Area:** tooling, verification.
- **Needs:** nothing.
- **Verify:** V6, V7.
- **Where:** `scripts/window-app.ts`, `.github/workflows/window.yml`,
  `cli/templates/projects.ts`, `scripts/example-app`.

- [ ] window.yml launches each app on the simulator or emulator and checks
      that a Lucent module answers and a component mounts.
- [ ] `lucent create`'s templates and both example apps move to the newest
      stable release. A nightly job builds the example app on the
      prerelease lane.
- [ ] The docs list the window, and the website's install page reads it
      from `REQUIREMENTS`.

**Done when:** window.yml runs every app green on three nights in a row.
This task closes the distribution gate.

<a id="t141"></a>

### T141: Builds from Xcode, and a package's pods in Expo apps

**Goal:** An iOS build from Xcode alone is current, and a package's own pods
bind in an Expo app.

- **Status:** ready.
- **Area:** tooling, iOS host.
- **Needs:** nothing.
- **Verify:** V5, V6, V7.
- **Where:** `runtime/native` (podspec), `app.plugin.js`,
  `cli/project.ts`.

Today iOS has no build phase that runs `lucent build`: a build relies on
Metro's watcher or on autolinking at `pod install`. `expo prebuild`
stops with LUCENT3004 at a package's pod that isn't installed yet.

- [ ] `lucent build` runs from the iOS build once pods are installed (a
      podspec `script_phase`, or a Podfile `post_install` hook), as
      Android's `lucentBuild` task does.
- [ ] In `expo prebuild`, a package pod missing from `Podfile.lock` defers
      iOS binding with a warning naming the pod and the step that binds
      it. The plugin then links the native package, so prebuild's
      `pod install` installs the pod.
- [ ] Builds with `use_frameworks! :linkage => :static` and with dynamic
      linkage.
- [ ] Tests: a package importing a pod its `lucent.json` declares, in a
      fresh Expo app (smoke install) and a bare app.

**Done when:** the smoke install's Expo app binds a package pod with no
manual step, and Xcode builds without Metro running.

<a id="t142"></a>

### T142: C++ libraries, extension callbacks and prefab

**Goal:** A package wraps a C++ library, as a Nitro C++ Hybrid Object
does, through typed extensions.

- **Status:** ready.
- **Area:** compiler, bindings, tooling.
- **Needs:** nothing.
- **Verify:** V2, V3, V4, V5, V8.
- **Where:** `extensions/`, `emit/extensions.ts`, `bindgen/src/c-header.ts`,
  `runtime/native` (CMake).

- [ ] C++ headers in `extensions`: a class is a handle (constructors by
      arity and type, methods, `const` and static members). `std::string`
      and `std::string_view` are strings, `std::vector` of numbers and
      strings an array, `std::optional` an optional, and enums enums.
      Templates and inheritance are refused with reasons.
- [ ] A generated wrapper catches C++ exceptions into the error struct, so
      none unwinds through Lucent.
- [ ] Extension functions take callbacks (refused today in
      `extensions/bind.ts`), called on a stated context.
- [ ] Extension calls can be cancelled: an `AbortSignal` reaches the
      function as a flag it reads.
- [ ] `android.prefab`: Gradle artifacts whose prefab modules the
      runtime's CMake links, with their headers on the extension's include
      path. Vendored frameworks and pods expose headers the same way.
- [ ] A fixture C++ library with a class, overloads, callbacks and
      exceptions, run on the host and the JNI host.
- [ ] `lucent-mmkv` through MMKV's C++ core on both platforms,
      benchmarked against react-native-mmkv (P1).

**Done when:** the fixture and `lucent-mmkv` pass on both platforms.

<a id="t143"></a>

### T143: Typed Kotlin and Java sources in packages

**Goal:** A package's own Kotlin and Java sources are typed in Lucent, as
its Swift sources are.

- **Status:** ready.
- **Area:** bindings, tooling.
- **Needs:** nothing.
- **Verify:** V2, V5.
- **Where:** `bindgen/src/`, `native-build-files.ts`.

Today a package's Swift sources are typed as `lucent:ios/LucentNative`,
but its Kotlin and Java sources are compiled and not bound.

- [ ] `android.nativeSources` Kotlin and Java compile into a jar the SDK
      cache keys on the sources' content, bound as
      `lucent:android/<package>`. The same sources ship in the library, so
      Gradle compiles them for the app.
- [ ] A compile failure is a diagnostic with the compiler's errors, as
      Swift's is with swiftc's.
- [ ] Tests on the desktop JVM host.

**Done when:** a fixture package calls its own Kotlin from Lucent.

<a id="t144"></a>

### T144: A web target for shared modules

**Goal:** A Lucent package serves React Native Web apps, as Expo's
`registerWebModule` does, per
[0077](decisions/0077-the-web-is-a-target-for-shared-modules.md).

- **Status:** ready.
- **Area:** tooling, compiler.
- **Needs:** nothing.
- **Verify:** V2, V6.
- **Where:** `metro/`, `platforms.ts`, `lib/sdk/platform.d.ts`.

- [ ] On web, Metro resolves a module's proxy to the module run as
      JavaScript, with the JavaScript `lucent:core`, and `PLATFORM` is
      `"web"`.
- [ ] A `*.web.lucent.ts` twin supplies the exports of a module that uses
      a platform. Without one, the diagnostic names the platform code.
- [ ] Views on web are a diagnostic.
- [ ] Tests: the Expo example app's web build runs a shared module and a
      module with a web twin.

**Done when:** the Expo example's web build passes in CI.

## Production candidate

<a id="t150"></a>

### T150: Reference ports for each parity row

**Goal:** Each row of [parity.md](parity.md) is proved by a port of a
widely used Expo or Nitro module (or a stated subset), whose JavaScript API
matches the original.

- **Status:** ready for each port whose needs are done.
- **Area:** verification, examples.
- **Needs:** each port names its tasks.
- **Verify:** V5, V6.
- **Where:** `examples/`, `scripts/device-check.ts`, `examples/*/evidence.json`.

Ports already in the repository: `lucent-secure-store`, `lucent-haptics`,
`lucent-camera`, `lucent-http`, `lucent-kv-storage`, `lucent-orbit`,
`lucent-rating` and `lucent-sensors`.

- [ ] `lucent-mmkv`: react-native-mmkv's API (T142).
- [ ] `lucent-file-system`: expo-file-system's file and directory objects,
      with byte streams (T100, T108).
- [ ] `lucent-image`: an expo-image subset, a view with an image object
      prop (T120).
- [ ] `lucent-video`: an expo-video subset: a player object, a view, a
      controller root, picture in picture (T120, T122).
- [ ] `lucent-frames`: a camera frame processor subset: an executor, frames
      as handles, a worklet consumer (T107, T109, T134).
- [ ] `lucent-background-task`: expo-background-task's API (T131, T132).
- [ ] `lucent-notifications`: push token, silent push and a notification
      service extension (T110, T133).
- [ ] `lucent-widgets`: a home-screen widget fed from the app (T133).
- [ ] Each port records its evidence in `evidence.json`, and the device
      check runs it on the simulator and emulator.

**Done when:** every parity row names a port that passes in CI.

<a id="t151"></a>

### T151: Lifetime, concurrency and Fabric stress validation

**Goal:** Races, cycles and recycling hold up under stress, on host,
simulator and emulator.

- **Status:** ready.
- **Area:** runtime, views, verification.
- **Needs:** nothing.
- **Verify:** V4, V6, V8.
- **Where:** `packages/runtime/test`, `scripts/device-check.ts`.

- [ ] Registration, completion and cancellation races, and synchronous
      re-entry, under TSan.
- [ ] 1,000 mount and dispose, and subscribe and cancel, cycles after
      warmup: owned counts return to baseline (P7).
- [ ] Hosts and views recycled while commands, events and measurements
      are in flight.
- [ ] Background and foreground, and Activity recreation, on the
      emulator, with the actors' platform glue.

**Done when:** each stress run passes in CI.

<a id="t152"></a>

### T152: The no-catalog audit

**Goal:** Show that no behavior depends on a list of SDKs, classes or
packages, views and extensions included.

- **Status:** ready.
- **Area:** bindings, compiler, verification.
- **Needs:** nothing.
- **Verify:** V2, V5.
- **Where:** `packages/`, `packages/compiler/test/fixtures`.

- [ ] The unknown-library tests extended to views, props, events and
      children.
- [ ] Every framework, class or package name in compiler, runtime, schema
      and build logic is listed, each classified as a language, ABI or
      platform anchor with its reason.
- [ ] A test fails when a new name appears outside that list.

**Done when:** the list is recorded in [contracts.md](design/contracts.md)
and the test runs in CI.

<a id="t153"></a>

### T153: Benchmarks against Nitro and Expo Modules

**Goal:** Measure the same operations through Lucent, Nitro, Expo Modules
and a C++ TurboModule, and publish the method with the numbers.

- **Status:** ready.
- **Area:** verification, performance.
- **Needs:** nothing.
- **Verify:** V6, V8.
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
compiles, and a migration path from Expo Modules and from Nitro.

- **Status:** waiting; needs T150.
- **Area:** docs.
- **Needs:** T150.
- **Verify:** V1, V9.
- **Where:** `apps/website/src/content/docs`.

- [ ] A guide per row, its samples compiled by the website check.
- [ ] Migration guides from Expo Modules and from Nitro, side by side,
      from the ports.
- [ ] The website's comparison table matches [parity.md](parity.md),
      checked by `scripts/website.ts`.

**Done when:** every row links a guide and the check passes.

<a id="t155"></a>

### T155: The production-candidate gate

**Goal:** One integrated commit passes every check, and its release
candidate is documented.

- **Status:** waiting; needs every other task but T135.
- **Area:** verification, release.
- **Needs:** T100 to T154, but T135.
- **Verify:** V1 to V9.
- **Where:** the whole repository.

- [ ] Every parity row is ✅ or has a recorded decision.
- [ ] The integration run below is green in one checkout.
- [ ] Changesets, version compatibility, source maps and crash reports
      checked on the candidate.
- [ ] [limitations.md](limitations.md) reconciled with the code.
- [ ] A release-candidate report: the exact artifacts and how to reproduce
      them.

**Done when:** the report is merged. This task closes the gate.

## Performance budgets

Host budgets are enforced by `node scripts/bench.ts --check` and
`node scripts/bench-build.ts --check`. CI's shared runners enforce the
kernels, the sizes and the edit loop, and report the boundary and floor
ratios, which move with the CPU (`--shared-runner`). A missed budget is
recorded and decided, never quietly weakened.

| Id  | Dimension          | Gate                                                                             | Where                                 |
| --- | ------------------ | -------------------------------------------------------------------------------- | ------------------------------------- |
| P1  | Primitive calls    | A call costs within 1.25x a handwritten C++ TurboModule's host function          | `scripts/bench-floor-budgets.json`    |
| P2  | Computation        | Each kernel's speedup over JavaScript stays above its budget                     | `scripts/bench-budgets.json`          |
| P3  | Batching           | A batched call costs less than its budget times 1,000 chatty calls               | `scripts/bench-boundary-budgets.json` |
| P4  | Code size          | Generated objects stay within their sizes at `-O2`                               | `scripts/bench-size-budgets.json`     |
| P5  | Edit loop          | p95 warm diagnostics under 500 ms; check and generation under 1 s                | `scripts/bench-build-budgets.json`    |
| P6  | Binary transport   | No payload copy on an owned handoff; copies and allocations counted              | the buffer tests                      |
| P7  | Teardown           | 1,000 mount and dispose cycles return owned counts to baseline                   | T120, T151                            |
| P8  | Against frameworks | Within 20% of the fastest of Nitro, Expo Modules and a TurboModule per operation | T153                                  |

Benchmarks keep raw samples, report the median, p95 and p99, interleave
implementations after warmup, verify outputs, and rerun noisy threshold
crossings before calling a regression.

## Validation

Every task names the profiles it must pass. Build the CLI with `pnpm build`
after changing `packages/`. Check a test runner's filter before relying on
it: a filter that runs zero tests proves nothing.

| Profile | Checks                                                         | How to run                                                                                                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| V1      | Formatting, lint, types, whitespace                            | `pnpm check`, `git diff --check`                                                                                                |
| V2      | Unit tests and the build                                       | `pnpm build`, `pnpm test:all`                                                                                                   |
| V3      | Native output against the same code run as JavaScript          | `HERMES_DIR=~/hermes node packages/compiler/test/e2e/run.ts [case…]`, then `node scripts/sync-examples.ts` after changing cases |
| V4      | The runtime, plain and under sanitizers                        | `packages/runtime/test/run.sh`, `SANITIZE=1 CXX=g++ packages/runtime/test/run.sh`, `SANITIZE=thread`                            |
| V5      | Platform bindings and glue against real SDKs                   | The bindgen, SDK-declaration and glue-compile suites (part of `pnpm test` where the SDKs are installed; macOS for iOS)          |
| V6      | The example apps on the iOS simulator and the Android emulator | `HERMES_DIR=~/hermes node scripts/app-check.ts apps/bare-example` and `apps/expo-example`; `node scripts/device-check.ts`       |
| V7      | Fresh apps from the packed package, on each supported release  | `node scripts/smoke-install.ts`; `node scripts/window-app.ts`                                                                   |
| V8      | Performance budgets                                            | `HERMES_DIR=~/hermes node scripts/bench.ts --check`, `node scripts/bench-build.ts --check`                                      |
| V9      | The website: pages, samples, links and prose                   | `node scripts/website.ts --check` (needs Vale)                                                                                  |

The integration run, in one checkout: `node scripts/sync-examples.ts`,
`pnpm build`, `pnpm check`, `pnpm test:all`, the e2e suite, the runtime
tests plain and under ASan and TSan, SDK coverage, the website check, the
smoke install, both app checks and the bench budgets. CI's `ci` check runs
the same set on each pull request, the parts a change touches.

## Former task ids

What became of each task of the earlier plan that is still linked, or was
still open on 2026-10-12. Done tasks not listed here are in
[CHANGELOG.md](../packages/lucent/CHANGELOG.md) and this file's history.

| Former id             | Title                                                  | Now                                                              |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| <a id="t28"></a>T28   | Prove automatic binding with unknown fixture libraries | Done (#68)                                                       |
| <a id="t49"></a>T49   | Conditional and keyed-list reactive lowering           | Done (#88)                                                       |
| <a id="t50"></a>T50   | Yoga with explicit layout-owner boundaries             | Done (#97)                                                       |
| <a id="t51"></a>T51   | The small Lucent UI library (issue #29)                | Dropped: no cross-platform view library (decision 0080)          |
| <a id="t52"></a>T52   | Wrapper ports and a views preview                      | [T150](#t150), without the device runs                           |
| <a id="t54"></a>T54   | Measured compiler and runtime optimizations            | Done (#90, #92, #93, #100)                                       |
| <a id="t55"></a>T55   | Native recycled and virtualized lists                  | Dropped with T51                                                 |
| <a id="t56"></a>T56   | Native gestures and frame-driven animation             | Dropped with T51                                                 |
| <a id="t59"></a>T59   | Media pipelines, high-rate streams and executors       | [T108](#t108), [T109](#t109), [T150](#t150)'s `lucent-frames`    |
| <a id="t60"></a>T60   | Headless, background and other native targets          | [T130](#t130) to [T135](#t135)                                   |
| <a id="t62"></a>T62   | The distribution and supported-version matrix          | [T140](#t140), [T141](#t141)                                     |
| <a id="t63"></a>T63   | The no-catalog audit                                   | [T152](#t152)                                                    |
| <a id="t64"></a>T64   | Lifetime, concurrency and Fabric stress                | [T151](#t151), without the device runs                           |
| <a id="t65"></a>T65   | Physical-device performance budgets                    | [T153](#t153) on the simulator and emulator; device runs dropped |
| <a id="t66"></a>T66   | User documentation and migration examples              | [T154](#t154)                                                    |
| <a id="t67"></a>T67   | The production-candidate gate                          | [T155](#t155)                                                    |
| <a id="t68"></a>T68   | Pilot packages for independent authors                 | Dropped: maintainer-only (decision 0080)                         |
| <a id="t69"></a>T69   | Pilot evidence                                         | Dropped: maintainer-only (decision 0080)                         |
| <a id="t70"></a>T70   | The final capability and readiness assessment          | Dropped: its report is part of [T155](#t155)                     |
| <a id="t71"></a>T71   | Native object references as view props                 | [T120](#t120)                                                    |
| <a id="t72"></a>T72   | Zero-copy bytes at the boundary                        | [T108](#t108)                                                    |
| <a id="t73"></a>T73   | Interop handles                                        | [T107](#t107)                                                    |
| <a id="t74"></a>T74   | Callback executors and stream backpressure             | [T109](#t109)                                                    |
| <a id="t75"></a>T75   | A window of stable React Native and Expo releases      | [T140](#t140)                                                    |
| <a id="t76"></a>T76   | App-delegate and Activity integration hooks            | [T110](#t110)                                                    |
| <a id="t77"></a>T77   | Classes the OS instantiates, and typed package Kotlin  | [T131](#t131), [T143](#t143)                                     |
| <a id="t78"></a>T78   | UIKit components with a view-controller root           | [T122](#t122)                                                    |
| <a id="t79"></a>T79   | C and C++ dependencies: C++ extensions and prefab      | [T142](#t142)                                                    |
| <a id="ta35"></a>TA35 | A package's own pods in an Expo app                    | [T141](#t141)                                                    |
| <a id="ta36"></a>TA36 | The gaps four reference ports need                     | Done (#128, #129); the ports are [T150](#t150)'s                 |
| <a id="ta37"></a>TA37 | The language gaps the review found                     | Done (#149); platform-file classes are [T106](#t106)             |
| <a id="ta41"></a>TA41 | Name reference cycles in debug builds                  | Done (#184, #185, #186); the device check dropped                |
| <a id="ta42"></a>TA42 | `RangeError` on stack exhaustion                       | Done (#173)                                                      |
| <a id="ta44"></a>TA44 | `WeakMap` and `WeakSet` keyed by instances             | Done (#170)                                                      |
| <a id="ta45"></a>TA45 | Each example's evidence, stated from the record        | [T150](#t150)                                                    |
| <a id="ta46"></a>TA46 | A web target for shared modules                        | [T144](#t144)                                                    |

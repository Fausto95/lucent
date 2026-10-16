# Design overview

The design in brief: why Lucent is built the way it is, and the model each
part follows. [native-platform.md](native-platform.md) is the full design,
[contracts.md](contracts.md) the interfaces its parts share, and
[views.md](views.md) the view runtime. [architecture.md](../architecture.md)
maps the code.

The plan is [ROADMAP.md](../../ROADMAP.md) and [tasks.md](../tasks.md).
Present tense describes the code; **planned** marks what doesn't exist
yet.

Lucent compiles a checked subset of TypeScript to C++20: modules in
`*.lucent.ts`, components in `*.lucent.tsx`. React Native calls the C++
over JSI through one C++ TurboModule, and Fabric renders the components.
Where an SDK API needs Swift or Kotlin, Lucent generates that code too. No
JavaScript engine runs on the native side.

## Principles

- **The source is the spec.** A module's exports are its API. The
  JavaScript proxy and its types, argument checks, native glue and
  component descriptions all come from them.
- **No catalog** ([0005][d0005]). APIs come from the SDKs and libraries the
  app installs. No list of SDKs, classes, views or packages selects
  behavior, so an unknown library binds like the SDK.
- **JavaScript semantics.** Native code behaves as the same source run as
  JavaScript, or fails to compile with a `LUCENT` diagnostic.
  [semantics.md](../semantics.md) lists every deviation and its reason.
- **Mechanisms in core, APIs in packages.** Core provides threads, buffers,
  lifecycle events and, planned, entry points. A background-task
  scheduler is a Lucent package built on them.
- **Predictable costs.** Copies, thread hops, ownership and rebuilds are
  explicit. A value copies at the boundary unless the code says otherwise.

## From source to native code

```text
installed SDKs and libraries ──► bindgen: schemas and binding plans
                                                 │
*.lucent.ts(x) ──► checker ──► analysis ──► IR ──► codegen syntax trees
                                                 │
     .lucent/native: runtime, generated C++, Swift, Kotlin and Java,
                     podspec, CMake, JavaScript proxies, React types
                                                 │
              one C++ TurboModule over JSI; Fabric components
```

- **Compiler** (`packages/compiler`). Whole-program analysis computes
  effects, owners and borrows. Every function lowers through an ordered,
  verified IR. Emitters build syntax trees (`packages/codegen`), never
  strings.
- **Runtime** (`packages/runtime/cpp/lucent`). A dependency-free C++
  implementation of JavaScript's values, with reference counting. The JSI
  layer (`lucent/jsi`) converts values at the boundary.
- **React Native glue** (`packages/runtime/cpp/rn`). `LucentModule`, the
  TurboModule named `Lucent`, and the Fabric hosts for components.
- **Native package.** `lucent build` writes `.lucent/native`, an ordinary
  React Native library that autolinking finds.

## Binding by rule

- **Discovery.** Declarations come from the app's resolved build: the SDKs,
  pods, Swift packages and Gradle classpath. They are read on first import
  and cached by content.
- **Facts.** Each symbol keeps its native identity and provenance. Thread,
  blocking and ownership facts default to unknown and carry evidence;
  nothing is inferred from a name.
- **Binding plans.** Type and ABI rules give each member a plan. The
  declarations, the checks and the glue all come from it, and a refused
  shape carries its reason (`lucent sdk coverage`).
- **Swift and Kotlin.** Swift-only and Kotlin-only APIs go through
  generated shims. `async` and `suspend` become promises that an
  `AbortSignal` cancels.
- **Explicit behavior.** Syntax is derived from declarations. Behavior
  that metadata can't prove is written out in code, and `fromCallback` and
  `subscribe` adapt any listener.

## Execution and ownership

| Context      | What runs there                                                                       | Rules                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Module actor | A package's code: synchronous exports on the JS thread, async work and callbacks here | One fair lock and one thread per import component. Actors run in parallel; a cyclic nested wait throws.    |
| Main         | Component setups, effects and commands; `main()` callbacks; iOS lifecycle listeners   | Never queues behind an actor. Module state only main-thread code uses is the main thread's, with no lock.  |
| Compute      | `compute(task, input)`                                                                | A pool of cores − 1 workers. Tasks share no state: input is copied or moved.                               |
| Executor     | Functions and delegates handed to the platform with `on(exec, …)`                     | A serial queue that never takes an actor's lock. Its code captures only constants, channels and executors. |
| JS thread    | Every JSI value                                                                       | Other threads hold `Host` ids and post to the JS thread.                                                   |

- An actor is a package, or the app's own modules
  ([0064][d0064]). A module never races with itself, and packages share no
  objects.
- The main thread enters an actor without a ticket. Deferred entries run
  when the actor is free. A callback that must answer now waits only for
  the holder in place.
- A promise resumes on the context that created it. No context waits on
  another, apart from that bounded main-thread wait.
- A `Channel` carries values between contexts. A send never waits, and
  its policy (lossless, latest or drop) decides what happens when full.
- Each JavaScript runtime has a `Host`. Work belongs to the runtime whose
  call started it, so a reload cancels only its own work. Module
  variables belong to the process.
- Pending work carries a token (runtime, scope, generation, operation). A
  late result never revives a disposed scope.

## Lifecycle

- **Module hooks** ([0071][d0071]). A module's top level is its create
  hook, and `onDestroy` its destroy hook. `EventEmitter.onObserved` says
  when JavaScript starts and stops listening.
- **App events.** iOS reports app and scene notifications through
  `onAppEvent` and `onSceneEvent`, observed from the binary's load.
  Android reports Activity events through `onActivityEvent`, tracked from
  process start. iOS presents view controllers with `present()`; Android
  starts activities for results and requests permissions.
- **Planned** ([0076][d0076], [T110](../tasks.md#t110)): one subscriber
  Lucent ships for what only the app delegate and the Activity receive.
  It adds to the app's delegate and never replaces it.

## Bytes and buffers

Arrays, objects and bytes copy at the boundary. Each exception is visible
in the code:

- **Moves.** A returned `ArrayBuffer` nothing else holds,
  `NativeBuffer.transfer()`, `transferToArrayBuffer()`, and buffers handed
  to compute tasks or channels.
- **Loans.** A synchronous export that only reads a byte argument reads
  JavaScript's bytes in place. `withRead` and `withWrite` lend spans that
  can't escape their callback.
- **Adoption.** Platform memory becomes a buffer without a copy: Android's
  direct `ByteBuffer` today, iOS planned ([T108](../tasks.md#t108)).

## Native extensions

A package wraps a C library as a typed extension: its header and a
`lucent.json` contract that says what C can't. Clang checks the contract
against the header. Lucent code imports it from `lucent:ext/<name>`. C++
libraries are planned ([T142](../tasks.md#t142)).

## Views

A component is an exported function of a `.lucent.tsx` module. Its setup
runs once per mount on the main thread and returns a UIKit or Android
view, or SwiftUI or Compose JSX. React sees a component with typed props,
events and ref commands. Platform-view JSX is derived from the view
classes' declarations by rule, as [views.md](views.md) describes.

## Execution modes

**Planned** ([T130](../tasks.md#t130) to [T136](../tasks.md#t136)).
Lucent code runs wherever the platform calls it, with or without
JavaScript:

- A **native root**: module state and actors started with no JavaScript
  runtime, which a later `Host` shares.
- **Launch-time modules**, run before the first frame, and **native entry
  points** that platform glue calls.
- Android **services, receivers, workers and widgets**, iOS **background
  tasks**, and iOS **app extensions** written as Lucent code.
- **App Intents and Live Activities**, and Android widget bodies.
- Calls from **worklet runtimes**, and from native code the app or a
  library ships ([T114](../tasks.md#t114)).

[native-platform.md](native-platform.md#execution-modes) states the
model and the decisions still open.

## Distribution

- **One npm package**, `@lucent-lang/lucent`: the CLI, the compiler, the
  runtime sources, the Metro integration, the Expo config plugin and the
  Gradle scripts.
- **Autolinking.** The native package is a React Native library: a pod on
  iOS, a pure C++ TurboModule on Android. The Expo plugin and a Gradle
  task run `lucent build`.
- **The release window** ([0074][d0074], [0079][d0079], [0127][d0127]).
  React Native 0.86 to 0.88 and Expo SDK 57 and 58, with a prerelease
  lane. No release in it needs a fallback.
- **Prebuilt core** ([0059][d0059]). Releases ship the JSI-free part of the
  runtime prebuilt. An app links it when its hash matches.
- **Build identity.** The native module embeds what it was built from.
  Proxies check it and name the rebuild a mismatch needs.
- **Packages** ship sources. An app compiles them all into one runtime.

[d0005]: ../decisions/0005-the-native-platform-plan-and-the-no-catalog-rule.md
[d0059]: ../decisions/0059-releases-ship-the-runtimes-core-prebuilt.md
[d0064]: ../decisions/0064-an-actor-per-package-and-the-main-thread-never-queues.md
[d0071]: ../decisions/0071-module-hooks-not-app-delegate-hooks.md
[d0074]: ../decisions/0074-a-window-of-stable-react-native-and-expo-releases.md
[d0076]: ../decisions/0076-an-app-delegate-and-activity-subscriber.md
[d0079]: ../decisions/0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md
[d0127]: ../decisions/0127-react-native-0-88-and-expo-sdk-58-join-the-window.md

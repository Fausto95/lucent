# Native platform design

Why Lucent is built the way it is, and the model each part follows,
current and planned. Rewritten from scratch on 2026-10-12 with the plan
([0080][d0080]). Present tense describes the code. **Planned** marks an
accepted plan or an open design, with its task in [tasks.md](../tasks.md).

[overview.md](overview.md) is this design in brief, and
[contracts.md](contracts.md) holds the interfaces its parts share (C-BIND,
C-EXEC, C-BUFFER and the rest). The view runtime is [views.md](views.md),
observable behavior [semantics.md](../semantics.md), and the code map
[architecture.md](../architecture.md).

## Goal and scope

**An author builds any module Nitro or Expo Modules can build, views
included, from one TypeScript source.** [parity.md](../parity.md) lists
what each system offers an author and where Lucent stands. The target is
React Native's New Architecture on iOS and Android, in bare and Expo apps,
on the releases of [the window](#the-release-window).

| The author wants              | The author writes                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| A native function             | An exported function of a `.lucent.ts` module                                           |
| A native object with identity | An exported class; `[Symbol.dispose]` releases it early                                 |
| Async work                    | `async` and `await`, cancelled through `AbortSignal`                                    |
| Platform APIs                 | Imports from `lucent:ios/<Module>` and `lucent:android/<package>`, in platform branches |
| Events to JavaScript          | An exported `EventEmitter`                                                              |
| Parallel work                 | `compute(task, input)`                                                                  |
| A native view                 | An exported function of a `.lucent.tsx` module that returns a view or toolkit JSX       |
| A C library                   | A typed extension: its header and a `lucent.json` contract                              |

Nitro and Expo leave some code to the author in Swift, Kotlin or C++:
background tasks, services, app extensions. In Lucent that code is
TypeScript written against the SDK, which the
[execution modes](#execution-modes) gate covers. What is out of scope is
in [ROADMAP.md](../../ROADMAP.md#not-planned).

## Principles

### The source is the spec

A module's TypeScript is its API. From its exports the compiler derives
the JavaScript proxy and its types, argument validation, the C++ entry
points and the module installer. For a component it also derives the
Fabric props, events, commands and descriptor. An author never writes a
spec, a registration name or a duplicate declaration.

### No catalog

Discovery is an invariant ([0005][d0005]). Lucent keeps no list of SDKs,
APIs, views or per-library bindings, and no behavior is selected by a
class, method, module or package name. Installing or upgrading a native
dependency makes its declarations available without a Lucent release.

A small fixed platform surface is allowed: JSI, Fabric, JNI, ARC, view
identity on each platform, and the app lifecycle. These are integration
points, not an API list. [T152](../tasks.md#t152) records each such name
with its reason, and a test fails on a new one.

So facts come from metadata or stay unknown: a method named `addListener`
doesn't prove how its listener is removed. Syntax is derived by rule, and
where a rule can't decide, the code says what it means
([below](#deriving-syntax-keeping-behavior-explicit)). What metadata can't
say, a package supplies, such as a typed extension.

### JavaScript semantics

[semantics.md](../semantics.md) is the contract. Each language feature has
a differential case in `packages/compiler/test/e2e/cases/`, which compares
the native build with the same source run as JavaScript. A deviation needs
a documented reason there and a row in `apps/website/src/docs/language.ts`.

Unsupported code fails with a `LUCENT` diagnostic, never with invalid C++
or a crash. A built-in is exact or refused ([0045][d0045]). A compiler
fault is `LUCENT9002` at the function being lowered ([0052][d0052]).
Recursion that would overflow throws `RangeError`, in Release builds too
([0073][d0073]).

### Mechanisms in core, APIs in packages

Core provides mechanisms: actors and executors, buffers, channels,
lifecycle events, and, planned, native entry points and launch-time
modules. An API built on them is a Lucent package: a background-task
scheduler, a notifications module, a widget kit. Core never special-cases
one, which keeps the no-catalog rule true for execution modes.

### Predictable costs

Copies, threads, ownership and rebuilds are explicit, and Lucent explains
each one. A value copies at the boundary unless the code shows a move, a
loan or an adoption. A thread hop happens where the code names a context:
`main()`, `compute`, an executor.

A build reports what the app needs next: a reload, a native recompile, a
relink or a reinstall. Performance budgets
([tasks.md](../tasks.md#performance-budgets)) are checked in CI.

## From source to native code

```text
installed SDKs, pods, Swift packages, Gradle classpath
        │  packages/bindgen: discovery, schemas, binding plans
        ▼
*.lucent.ts(x) ─► checker ─► analysis ─► IR ─► emitters ─► codegen trees
                  program.ts  analysis/   ir/    emit/, ui/   packages/codegen
                                                                │
        .lucent/native ◄────────────────────────────────────────┘
        runtime, generated C++, LucentShims.swift, Kotlin shims, Java,
        podspec, CMake, react-native.config.js, JS proxies, React types
                │
        LucentModule (pure C++ TurboModule) over JSI; Fabric components
```

### The compiler

`packages/compiler` works in five steps:

1. **Program** (`program.ts`). The TypeScript checker types the program,
   strict and with `noUncheckedIndexedAccess`, per target.
2. **Types** (`types.ts`). Each type maps to a native representation:
   structs by shape, tagged unions, optionals, classes.
3. **Analysis** (`analysis/`). Effects, owners, captures and borrows for
   the whole program (`ProgramFacts`), so compute tasks, views and buffer
   spans are checked against what code does. A refusal names its cause.
4. **IR** (`ir/`). Every function, setup and compute variant lowers to one
   semantic IR of ordered operations, verified before emission
   ([0016][d0016]).
5. **Emission** (`emit/`, `ui/`). Emitters build syntax trees from
   `packages/codegen` (C++, Java, Kotlin, Swift, TypeScript, XML), never
   source strings.

A value keeps one representation everywhere, except a value only its own
local sees: an integer array, or a struct on the stack ([0063][d0063]).

### Rules for generated code

These hold for every line Lucent generates:

- **No unspecified evaluation order.** A plan's operands lower first, in
  source order (`operands` in `ir/lower.ts`). C++ argument order never
  decides behavior.
- **Coroutine frames own their captures.** A coroutine never refers to a
  lambda's captures, which may be gone when it resumes.
- **JSI values stay on the JS thread.** Other threads refer to them by
  `Host` ids ([below](#javascript-values-and-hosts)).
- **`-ffp-contract=off`** in every build: podspec, CMake, test harnesses.
  JavaScript rounds `a * b + c` twice; a fused multiply-add rounds once.
- **A stack check** on entry to each function that runs program code
  ([0073][d0073]).

### The runtime

`packages/runtime/cpp/lucent` is a C++ runtime with no dependencies. It
implements JavaScript's values: numbers, UTF-16 strings, arrays, maps,
sets, `bigint`, `Date`, `RegExp`, JSON, errors and bytes. Objects are
reference counted. A cycle leaks until it is broken, through `WeakRef` or
a `WeakMap` ([0072][d0072]), and debug builds name each cycle left at
teardown.

`platform/` holds the runtime's iOS and Android adapters, `jsi/` the
JavaScript boundary, and `../rn/` the TurboModule and the Fabric hosts.
Header names never shadow system headers (`jsstring.h`, `jserror.h`).

### The native package

`lucent build` writes `.lucent/native`, an ordinary React Native library
([architecture.md](../architecture.md) lists its files). Only changed
files are rewritten, so native builds reuse their objects. The module
units (`m_<module>.cpp`) reach no JSI or React Native header. Only the
installers (`lucent_bindings.cpp`), the build identity and components'
Fabric units do, which the [execution modes](#execution-modes) build on.

## Binding by rule

### Discovery

Declarations come from the app's resolved build, never from a list. On
iOS: the SDK at the app's deployment target, the pods Podfile.lock
installed, the app's Swift packages and vendored frameworks. On Android:
the SDK platform, and every jar and AAR of the resolved compile classpath.

`packages/bindgen` reads them with Swift symbol graphs, clang, a JVM class
file reader and a TypeScript decoder of Kotlin metadata ([0006][d0006]),
as [platform-bindings.md](../platform-bindings.md) details. A module is
extracted on first import, and cached by the artifacts' contents, the
target, the extractor and the schema format, never a path.

### Schemas, facts and plans

A schema describes each class, protocol, enum and struct (C-BIND). A
symbol's identity is its native one: a Clang or Swift USR, or a JVM owner,
name and descriptor. Its TypeScript name is a separate display name, and
each schema records its provenance.

Facts such as thread affinity, blocking, callback timing and ownership
default to unknown and carry their evidence (`bindgen/src/facts.ts`). An
`@MainActor` attribute proves where code runs, not that it is fast. A
missing fact never means "safe".

`bindgen/src/binding-plan.ts` derives one plan per member from type and ABI
rules. A plan names its backend, one conversion per value, how failure is
reported and the artifacts to link. The backends are Objective-C, JNI,
Swift and Kotlin shims, the C ABI, and source for toolkit bodies.

The compiler documents a declaration, refuses a use and emits glue from
the same plan, so the three can't disagree. A shape no rule covers carries
its reason into the diagnostic and into `lucent sdk coverage`, which
counts each member's stage.

`lucent sdk lock` records the SDKs a project builds against, and
`--frozen` builds fail when the installed ones differ. `lucent sdk diff`
lists what an upgrade changes for the symbols the code uses. `lucent sdk
lock --schemas` exports those schemas, so a machine without Xcode still
type-checks iOS code ([0057][d0057]).

### Swift and Kotlin

Some APIs only Swift or Kotlin can call: a Swift-only type or member, an
`AsyncSequence`, a Kotlin `suspend` function, a default argument, a value
class. For those Lucent generates code, one shim per member the program
uses. Swift shims are `@_cdecl` functions in `LucentShims.swift`, with
Swift values boxed ([swift-shims.md](swift-shims.md)). Kotlin shims live
in `dev.lucent.shims`, and a `suspend` call starts in a runtime-owned
scope.

`async` and `suspend` members become promises cancelled through
`AbortSignal`. An `AsyncSequence` is collected as a `Flow` is
([0055][d0055]).

### Callbacks, delegates and subclasses

Lucent classes take part in the platform's object model:

- **Objective-C:** a class implementing protocols becomes an object that
  forwards each requirement (`emit/delegates.ts`); one extending a class
  gets a generated subclass (`emit/objc-subclass.ts`).
- **Swift:** a class conforming to a Swift-only protocol gets a Swift proxy
  class (`emit/swift-proxy.ts`).
- **Java:** a class implementing an interface is a reflection proxy
  (`NativeProxy.java`). One extending a class gets a generated Java
  subclass (`emit/java.ts`), today only for bases with a public
  no-argument constructor.

A completion handler, or an `async` or `suspend` member, becomes a promise
from its metadata. Any other listener goes through `fromCallback` or
`subscribe` from `lucent:core`, whose races are defined once in the
runtime: settlement wins once, and cleanup runs exactly once.

### Numbers, errors, threads and availability

- **Integers.** Every native 64-bit integer is a `bigint`
  ([0008][d0008]). A parameter also takes a safe-integer `number`
  ([0070][d0070]).
- **Errors.** An `NSError` or Java exception becomes a Lucent `Error` that
  keeps the native object, which `nativeError(e)` returns ([0069][d0069]).
- **Threads.** A main-thread-only API used outside `main()` or view code
  is `LUCENT3006`. A blocking call on the main thread is `LUCENT3009`.
- **Availability.** An API newer than the app's oldest OS needs an
  `available()` guard (`LUCENT3007`). Android's oldest is the app's
  `minSdk`.

<a id="165-derive-syntax-make-native-behavior-explicit"></a>

### Deriving syntax, keeping behavior explicit

Lucent derives ergonomic syntax from declarations by rule. It never infers
behavior a declaration doesn't state, and the raw member stays reachable
beside any sugar. Where a rule is ambiguous, the result is a diagnostic or
explicit code, never a guess.

Platform-view JSX shows the split. `packages/compiler/src/sdk/view-rules.ts`
is pure functions over a class's schema, and each attribute it gives comes
with its rule and its source declaration:

- **Props:** writable properties, and Android's one-value `set<X>` methods.
- **Events:** Android's `setOn<X>Listener(L)` where `L` has one method, and
  iOS's `addAction:forControlEvents:` cases.
- **Children:** through the insert-at-index method the class declares,
  with no adapter API ([0027][d0027]).
- **Construction:** iOS `initWithFrame:` or `init`, Android's `(Context)`
  constructor. Otherwise the element says how:
  `<RenderSurface create={() => new RenderSurface(device, options)} />`.

What the rules can't see stays explicit. A multi-method listener is a
Lucent class implementing the extracted interface. Android's `AdapterView`
declares `addView(View, int)` and throws from it: the rules read
declarations, not behavior, and [limitations.md](../limitations.md) says so.

Awaiting follows the same rule. `await` on a native object is
`LUCENT1010`. Native `async` and `suspend` come from metadata, and
`fromCallback` adapts any other API. Named awaitables were removed rather
than moved into a table ([0005][d0005]).

## Execution and ownership

### Contexts

Lucent code runs on these kinds of execution context (C-EXEC,
`execution.h`; an `IsolatedContext` is a compute worker's):

| Context      | Runs                                                                      | Rules                                                                                   |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Module actor | A package's exports, async continuations and platform callbacks           | One fair lock and one thread per import component; the thread starts with its first job |
| Main         | Component setups, effects and commands; `main()` callbacks; iOS lifecycle | The platform's UI loop; never takes a ticket on an actor's lock                         |
| Compute      | `compute(task, input)`                                                    | A bounded pool; tasks share no state and take no lock                                   |
| Executor     | Functions and objects handed to the platform with `on(exec, …)`           | A serial queue of its own; never takes an actor's lock                                  |

Each context has its own queue, microtask queue and root scope. A promise
belongs to the context current at its creation, and its continuations
resume there; settlement from another thread is posted. No context waits
synchronously on another, apart from the bounded main-thread wait below.

### Module actors

An actor is an import component: modules that import one another,
type-only imports included ([0064][d0064], `emit/actors.ts`). That is a
package, or the app's own modules, and generated code names it
(`lucent_app::actor_N`) at every entry.

Every entry into a module holds its actor's lock: a synchronous call from
the JS thread, a turn on the actor's thread, a platform callback. Async
functions run on the actor's thread and interleave only at `await`, so a
module never races with itself. The lock (`LucentLock`, `scheduler.h`) is
a fair, recursive ticket lock. An actor called only synchronously never
starts a thread.

Packages on different actors share no objects. One reaches another only
through JavaScript or a platform re-entry, which nests the two locks. A
nested wait that would close a cycle throws `Lucent: deadlock` instead of
hanging. JavaScript decides the order, so no fixed lock order works.

### The main thread never queues

The main thread never takes a ticket, so it never waits behind queued
module jobs:

- **Deferred entries** (`main(f)`, `present()`, iOS lifecycle listeners) run
  once their actor is free, and the main thread does other work meanwhile
  (`enterFromMain`).
- **Entries that must answer now** (a delegate method's result) wait only
  for the current holder, which hands the lock over ahead of every ticket
  (`lockFromMain`). Debug builds warn past 50 ms.
- **A synchronous JavaScript callback** lends its thread's actors to the
  main thread while it runs (`ParkedActors`). JavaScript that waits for the
  main thread inside a callback can't deadlock it.

A main-thread delegate still waits for the job holding its package.
[T109](../tasks.md#t109)'s executors remove that wait for most callbacks.

### Main-thread state

A component's setup and the code it runs live on the main context, with
no actor lock. They may still use module state, by rule ([0046][d0046]): a
module variable only main-thread code uses belongs to the main thread
(`analysis/main-state.ts`). One that module code also uses is refused in
the view, naming both uses. **Planned** ([0075][d0075],
[T120](../tasks.md#t120)): the same rule for an instance's members, so an
instance of an exported class can be a view prop.

### Compute

`compute(task, input, { signal })` from `lucent:core` runs a top-level
function on a pool of workers (`compute.h`): cores − 1, at least one. Up
to 1,024 tasks may wait; beyond that, `compute` rejects with
`QuotaExceededError`.

The compiler checks the task's reachable code: no module state, no
main-thread or unknown native code, nothing asynchronous (`LUCENT3011`).
Its input and result must be data (`LUCENT3012`). The input is copied when
`compute` is called, aliases and cycles kept, and a `NativeBuffer` in it
moves.

Cancellation is cooperative: each loop iteration of the task's module
functions is a safepoint. The outcome settles once, on the caller's
context.

### Executors

In progress ([0078][d0078], [0081][d0081], [T109](../tasks.md#t109)).
`executor(label)` from `lucent:thread` is an `ExecutorContext` (C-EXEC
v1.8): a serial dispatch queue on Apple platforms, a thread of its own
elsewhere, never taking an actor's lock. Platform APIs take it as a queue
or a `java.util.concurrent.Executor` (`dev.lucent.LucentExecutor`):

```ts
import { Channel } from "lucent:core";
import { executor, on } from "lucent:thread";

// In the function that hands the analyzer over: what it captures is made there.
const frames = executor("camera.frames");
const sizes = new Channel<number>("latest");
analysis.setAnalyzer(
  frames,
  on(frames, (image) => {
    sizes.send(image.getWidth() * image.getHeight());
    image.close();
  }),
);
```

`on(exec, f)` wraps a function literal where it is handed to the
platform: a block, a Java functional interface or a Kotlin function. The
glue enters the executor's context at once when the platform calls it
there, and posts a turn from any other thread. Executor code is checked
as a compute task's is, but may use native code of unknown thread. It
captures only constants, channels and executors, and its results leave
through a `Channel`. An object goes on an executor where it is made,
`on(exec, new Frames(…))`, and keeps `this` to itself, so its class's
members are the executor's ([0082][d0082]). **Planned:** `EventEmitter`
events posted from an executor.

### Channels

`Channel<T>` from `lucent:core` carries values from a producer on any
thread to a consumer on its own context (`channel.h`). A send never waits.
When the consumer falls behind, the policy decides: `lossless` refuses the
send, `latest` keeps only the newest value, `drop` drops the oldest.

A value is copied when sent, and a `NativeBuffer` moves; a dropped buffer
is closed at once. `receive()` returns a promise, and `subscribe` delivers
values one at a time.

### JavaScript values and hosts

Each JavaScript runtime has a `Host` (`jsi/host.h`), created on the JS
thread when the runtime first touches `Lucent`. It owns every JSI object
Lucent keeps alive: promise resolvers, callbacks, prototypes, the identity
cache, held `JSValue`s. Native code refers to them by id and posts to the
JS thread to use them (`postToJs`).

An exported class instance crosses with its identity: the same native
object is always the same JavaScript object, and `instanceOf` refuses a
torn-down host's objects. A callback called during a synchronous call from
JavaScript runs at once; called later, it is posted.

### Scopes, operations and tokens

Work has owners (C-EXEC, `scope.h`, `operation.h`). A scope moves one way,
active to disposing to disposed. Disposal disposes its children, cancels
its pending operations, then runs its cleanups in reverse order, exactly
once.

An operation settles once: the first outcome wins, and a losing payload is
released, never delivered. Each pending operation carries a token of four
ids: runtime, scope, generation and operation. A late result whose token
no longer validates is dropped, so it never revives a disposed or
recycled scope. A `NativeRef` releases its platform object on the context
it names.

### Call directions

| Call                               | Where it runs                                                         | Values                            |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| JavaScript → synchronous export    | JS thread, holding the actor's lock                                   | Validated; copied or lent         |
| JavaScript → async export          | The actor's thread; the result is posted to JavaScript                | Copied at the call                |
| JavaScript → component command     | Queued to the mount on the main thread; a request answers a promise   | Copied                            |
| Platform → callback with no result | A turn of the actor (`postCallback`)                                  | Retained or copied by the binding |
| Platform → callback that answers   | The calling thread, holding the actor (`callNow`); on main, see above | Retained or copied by the binding |
| Platform → `on(exec, f)` callback  | The executor's queue, entered directly; no actor                      | Constants, channels and executors |
| Module code → `main(f)`            | The main thread once the actor is free, holding it                    | Shared with the module            |
| Module or view code → `compute`    | A worker; the result settles on the caller's context                  | Copied, or moved for buffers      |
| Lucent → JavaScript callback       | At once inside a synchronous call from JavaScript; posted otherwise   | Copied                            |

### Several runtimes

Work module code starts belongs to the runtime whose call started it
(`RuntimeEntry`, carried by posts). Tearing a runtime down disposes its
scopes, rejects its owed promises and drops its posts, and another
runtime's work goes on. Module variables are the process's, since
per-runtime storage would change every variable access. `Host::create`
resets them only when no other runtime is live, so the first runtime and
each reload whose old runtime is gone start them anew. A reload whose old
runtime is still live keeps them.

## Lifecycle

### Module hooks

A module's top-level code is its create hook ([0071][d0071]). It runs
when a JavaScript runtime installs Lucent, holding the module's actor,
through the generated `resetModuleState()`. `onDestroy(hook)` from
`lucent:core` is the destroy hook: it runs at that runtime's teardown,
holding the actor, before a reload initializes the modules again.

`EventEmitter<Events>` is typed like Expo's ([0066][d0066]). Its
`onObserved(name, observer)` reports an event's first listener and its
last one leaving, so a module runs a native source only while someone
listens. A reload takes JavaScript's listeners with the runtime.

### App and scene events

- **iOS** (`platform/ios_ui.mm`). A `+load` observer follows UIKit's app
  and scene notifications from the binary's load, on the main thread. The
  C++ core (`lifecycle.h`) knows scenes by id only, so it can't keep a
  window alive. `onAppEvent` and `onSceneEvent` subscribe to it.
- **Android** (`platform/android_activity.cpp`, `LucentActivities.java`).
  `LucentInitializer`, a content provider, installs Activity tracking at
  process start, before any Activity or JavaScript. `onActivityEvent`
  reports each Activity's lifecycle and new intents, and
  `currentActivity()` returns the one in front, held weakly.

Results and presentation are scoped operations that settle once. On iOS,
`present(build, signal)` shows a view controller from the scene in use
(`presentation.h`). On Android, `startActivityForResult` and
`requestPermissions` go through a translucent `LucentRequestActivity`,
so a request survives the app's Activity being recreated.

### The app-delegate and Activity subscriber

**Planned** ([0076][d0076], [T110](../tasks.md#t110)). Some events reach
only the app delegate or the Activity: opened URLs, user activities, push
tokens, remote notifications, background URL sessions, back presses.
Lucent ships one subscriber for them and never replaces the app's delegate.

In an Expo app it is an `ExpoAppDelegateSubscriber` and a
`ReactActivityLifecycleListener`, declared in an `expo-module.config.json`
the build writes. In a bare app, `lucent init` adds one forwarding line
per delegate method, which `lucent doctor` checks.

Events arrive typed through `onAppEvent` and `onActivityEvent`. Remote
notification handlers answer the fetch result through a promise with a
deadline, merged across modules as Expo merges them. The URL or activity
that launched the app waits for its first subscriber.

## Bytes and buffers

### Paths across the boundary

Arrays, records, maps, sets, plain objects, `Uint8Array`s and
`ArrayBuffer`s cross the boundary as copies, so a native mutation never
reaches the caller's value. Every exception is explicit, documented in
[semantics.md](../semantics.md#crossing-the-javascript-boundary) and
C-BUFFER:

| Path                | When                                                                         | Copies              |
| ------------------- | ---------------------------------------------------------------------------- | ------------------- |
| Copy                | The default                                                                  | One per crossing    |
| Move out            | A returned `ArrayBuffer`, or whole-buffer `Uint8Array`, nothing else holds   | None                |
| Move                | `transfer()`, `transferToArrayBuffer()`, a buffer in a compute input or send | None                |
| Loan in             | A synchronous export that only reads a byte argument                         | None, for the call  |
| Borrow              | `withRead` and `withWrite` on a `NativeBuffer`                               | None, for the call  |
| Address loan        | `NativeBuffer.handle()`                                                      | None, until release |
| Adoption            | Platform memory taken as a buffer: Android's direct `ByteBuffer` today       | None                |
| JavaScript's borrow | `withRead` or `withWrite` called from JavaScript                             | One, counted        |

### Moves

A move leaves its source unusable. `NativeBuffer.transfer()` moves the
storage to a new handle, and every alias of the old one then throws
`InvalidStateError`. A use the compiler can tell follows a move is
`LUCENT3031`.

A returned `ArrayBuffer` that nothing else holds moves to JavaScript,
since its copy would be the only one. Its size is reported to the
collector (`setExternalMemoryPressure`), as a `NativeBuffer`'s is and a
`NativeSized` class instance's `nativeSize`, at each crossing and after
each call from JavaScript (0084).

### Loans

A synchronous export that only reads a `Uint8Array` or `ArrayBuffer`
argument reads JavaScript's own bytes while it runs (`emit/lent-bytes.ts`).
The check is syntactic and conservative: a write, store, return or capture
keeps the copy. As in JavaScript, a write JavaScript makes during the call
shows.

`withRead` and `withWrite` lend a `NativeBuffer`'s bytes as a span for one
call (`buffer.h`). Reads share; a write excludes everything else, and a
conflicting borrow throws at once. A span returned, stored, captured or
held across `await` is `LUCENT3030`. JavaScript is never given memory a
worker may write: its borrows get a copy, written back after `withWrite`.

### Adoption, handles and memory pressure

Adoption takes platform memory as a buffer, with the release it needs and
the context that release runs on (`NativeBuffer::adopt`). `adoptByteBuffer`
in `lucent:android` adopts a direct `ByteBuffer`. `NativeBuffer.stats()`
counts allocations, adoptions, transfers and copies, so a test proves a
path doesn't copy. A `NativeHandle` is an address other native code takes,
with a `release()` that runs once from either side (`handle.h`).

**Planned:** iOS adoption of `NSData` bytes and `CVPixelBuffer` planes,
and Android's `HardwareBuffer` ([T108](../tasks.md#t108)). Platform
makers for handles, and classes that state their native size to the
collector ([T107](../tasks.md#t107)). Every typed array and `DataView`, on
the same paths as `Uint8Array` ([T100](../tasks.md#t100)).

## Native extensions

Metadata can't describe every library. A package covers the rest with a
typed native extension (C-EXT, [lucent-packages.md](../lucent-packages.md)).
It ships a C header and its implementation in its `nativeSources`, which
both platforms build into the one native package.

`lucent.json` `extensions` says what C can't: which functions create and
destroy a handle, which pointers are bytes or strings, the error struct,
and when a call fails. `lucent build` checks every name and shape against
the header with clang. Lucent code, shared code included, imports the
functions and handles from `lucent:ext/<name>`. Nothing escapes a call,
and every integer is range-checked as it enters C.

**Planned:** C++ headers as classes, callbacks, cancellation and prefab
([T142](../tasks.md#t142)), with C++ exceptions caught before they reach
Lucent. A package's own Kotlin and Java typed in Lucent
([T143](../tasks.md#t143)); its Swift sources already are, as
`lucent:ios/LucentNative`.

## Views in brief

[views.md](views.md) is the design of record. A component is an exported
function of a `.lucent.tsx` module, which the app imports as
`lucent:views/<module>`. Its setup runs once per mount on the main thread
and returns a UIKit or Android view, or SwiftUI or Compose JSX
([0010][d0010], [0012][d0012]). One file holds the logic once and each
platform's body in a `PLATFORM` branch ([0013][d0013]).

- **Toolkits.** `lucent:swiftui` comes from the installed Xcode's SwiftUI,
  `lucent:compose` from Compose's Kotlin metadata. Bodies are emitted as
  Swift `View`s and `@Composable`s.
- **Fabric.** Each component gets generated props, an event emitter, a
  shadow node and a descriptor. Props arrive as whole commits, and
  `signal` and `effect` update the view. Events are discrete,
  `Continuous` or `Coalesced`; commands come from `expose`.
- **Children** go into one `slot()`, and `invalidateSize()` re-measures
  native content. Views keep updating while JavaScript is blocked.

**Planned:** instances of exported classes as props
([T120](../tasks.md#t120)), React Native's view props
([T121](../tasks.md#t121)), view-controller roots
([T122](../tasks.md#t122)) and objects in toolkit bodies
([T123](../tasks.md#t123)).

## Execution modes

**Planned** ([T130](../tasks.md#t130) to [T136](../tasks.md#t136), and
[T114](../tasks.md#t114) for native code that calls Lucent). The gate's
goal: Lucent code runs wherever the platform calls it, on the
thread it needs, with or without JavaScript. Nitro and Expo authors write
this code by hand, or Expo ships it as packages. This section states the
intended model and the decisions still open.

### What exists today

Module code runs only after a JavaScript runtime installs Lucent:

```text
JS requires a proxy ─► TurboModuleRegistry "Lucent" ─► LucentModule::create
   ─► Host::create ─► attachRuntime ─► resetModuleState()
                       (only when no other runtime is live)
   ─► each module's top level, holding its actor, in import order
```

`resetModuleState()` is generated into `lucent_bindings.cpp`, a JSI unit,
and nothing native can enter module code.

Much already runs without JavaScript, though. Actors, contexts and
channels use no JSI, and module units reach no JSI header. `RuntimeId` 0
means no runtime, and without one `moduleScope()` is the actor's
never-disposed root. iOS observes lifecycle notifications from `+load`,
and Android tracks Activities from `LucentInitializer`, before
`Application.onCreate`.

### The model

```text
     the OS starts the process: launch, a task, a push, an extension
                                  │
   launch modules ─────► native root ◄───── JavaScript hosts, optional:
   (lucent.json)         module state,      React Native's runtime,
                         actors, contexts   worklet runtimes
                                  ▲
   native entry points ───────────┘  called by generated Java classes,
                                     iOS handlers, extension classes
```

Core adds the native root, launch-time modules, native entry points, and
the platform glue that calls them. A background-task package, a
notifications package and a widget kit are then Lucent code built on
them ([T150](../tasks.md#t150)'s ports), none a core special case.

### The native root

**Planned** ([T130](../tasks.md#t130)). The native root starts the runtime
with no JavaScript: module state initialized, actors and contexts running,
under `RuntimeId` 0. A JavaScript `Host` is then one more client, and sees
the same module state when it installs.

Module initialization moves out of the JSI unit into a JSI-free one. The
proposal is that it runs once, at first use: a launch, an entry point or a
`Host`'s install. Without a runtime, a call that needs one throws a typed error, such as
calling a JavaScript callback; an event with no listener is dropped. Work
an entry point starts belongs to a scope of that call, so the platform
ending the task cancels it.

**Open:** when a reload resets module state once native roots exist. The
task's example is to reset only when no native root holds the state.
What "holds" means is part of the decision: an entry point in flight, a
launch module, a running service. Three rules of today's runtime have to
change with it:

- `Host::create` resets module state whenever no other JavaScript runtime
  is live (`jsi/host.cpp`). A native root isn't an attached runtime, so
  the first JavaScript install would wipe the root's state.
- Module setup at `RuntimeId` 0 puts its work and its `onDestroy` hooks
  under the actor's root scope, and only a `Host`'s teardown runs destroy
  hooks, so they would never run.
- `currentRuntime()` falls back to the last attached live runtime
  (`execution.h`). A worklet `Host`, or React Native starting during a
  background task, would then own an entry point's work and cancel it at
  its own teardown.

**Open:** loading the code on Android. Lucent's C++ is an `OBJECT`
library built into the app's `appmodules`, linked against JSI, React
Native and fbjni, and its JNI environment comes from fbjni. Running from
`LucentInitializer` or from a `Worker` in a cold process means loading
that library before React Native does, or building a JSI-free library of
its own.

### Launch-time modules

**Planned** ([T130](../tasks.md#t130)). `lucent.json` gains `launch`: the
modules created at app launch, before the first frame, for registrations
the OS requires by then. iOS requires every `BGTaskScheduler` handler
before `application(_:didFinishLaunchingWithOptions:)` returns. Android
notification channels and WorkManager setup belong there too.

Launch code runs on the main thread during startup, holding its actor. It
must be short, and its time is traced.

**Open:** where launch runs. On iOS, inside `didFinishLaunching` through
the subscriber ([T110](../tasks.md#t110)), or from load; whether the
launch notification comes early enough for `BGTaskScheduler` is
unverified. On Android, from `LucentInitializer` before
`Application.onCreate`, or from the `Application` itself.

### Native entry points

**Planned** ([T130](../tasks.md#t130)). An entry point is a generated C
function that runs a module function, or a Lucent instance's method, on
its actor through the native root. The glue of [T131](../tasks.md#t131),
[T132](../tasks.md#t132) and [T133](../tasks.md#t133) calls them, and so
does native code the app or a library ships ([T114](../tasks.md#t114)).
Worklet runtimes go through a `Host` instead ([T134](../tasks.md#t134)).

A synchronous entry runs on the calling thread holding the actor, as
`callNow` does today, and follows the main-thread rule there. An async
entry reports its outcome to a completion the caller passes: a C function
and a context pointer. Arguments are data and platform objects.

**Open:** which functions get entry points, and how they are named. A name
the OS stores must stay stable across app updates (see below). How an
entry reports an error: `callNow` reports it and returns a default result
today, which doesn't suit a result the OS reads, such as a `Worker`'s.

### Android classes the OS instantiates

**Planned** ([T131](../tasks.md#t131)). A `Service`, `BroadcastReceiver`,
WorkManager `Worker`, `AppWidgetProvider`, `TileService`,
`FirebaseMessagingService` or `Fragment` is a Lucent class. Today
`android.components` declares such a component, but its class must be Java
or Kotlin the package ships.

- The Lucent class extends the SDK base. Its generated Java subclass has
  the constructor the OS calls: none, or `Context` and `WorkerParameters`
  for a `Worker`.
- On first use, on the calling thread, the subclass creates its Lucent
  instance through the native root. Its overrides call the Lucent methods,
  as generated subclasses do today.
- `lucent.json` `android.components[].class` names the Lucent class, and
  the manifest's `android:name` is the generated class.
- A `CoroutineWorker` needs a Lucent `async` method overriding a Kotlin
  class's `suspend` member ([T112](../tasks.md#t112)). Implementing an
  interface's works already.

Each callback keeps its platform's rules: `onReceive` returns quickly, and
`doWork` blocks a background thread for its result. Calls on the main
thread enter the actor as main-thread entries do.

**Open:**

- How a class is marked as OS-instantiated without a list of bases.
  Manifest components can name it, but WorkManager and `FragmentManager`
  instantiate by class name with no manifest entry.
- Which constructors the generated class declares. Metadata says what the
  base declares, not which one the OS calls.
- Stable names. WorkManager stores a worker's class name in its database,
  so a generated name must survive app updates. Today it derives from the
  C++ name (`javaSubclassName` in `emit/java.ts`).

### iOS background execution

**Planned** ([T132](../tasks.md#t132)), after [T110](../tasks.md#t110) and
[T130](../tasks.md#t130). Background tasks, background URL sessions and
silent pushes run Lucent code with no JavaScript, as `expo-background-task`
and `expo-notifications` tasks do.

- A launch module registers `BGTaskScheduler` handlers through the SDK
  binding, as ordinary Lucent code, and each runs through the native root.
- The task's expiration aborts an `AbortSignal` the handler holds, and the
  handler reports completion.
- `backgroundURLSession` and `remoteNotification` events relaunch the
  process into the native root when it isn't running.
- `UIBackgroundModes` and the permitted identifiers come from
  `lucent.json` `ios.infoPlist`. Tests use a debug-build trigger, since the
  simulator never launches background tasks.

**Open:** whether `lucent build` should check the identifiers at all.
Recognizing a call to `BGTaskScheduler` by name would be a catalog entry,
so a check would compare identifiers declared in `lucent.json` with
`Info.plist`.

### App extensions and widgets

**Planned** ([T133](../tasks.md#t133)). A package's Lucent code runs in an
app extension: a widget with a SwiftUI body, a notification service
extension, a share extension.

- **Target.** A second native build of the same program, without React
  Native. It links the JSI-free runtime core and the modules the extension
  reaches.
- **Principal class.** A Lucent class becomes the extension's principal
  class, or its widget: a `TimelineProvider` through the Swift proxy, the
  body through SwiftUI JSX.
- **API limits.** APIs unavailable to extensions are refused in extension
  code, from their availability attributes. No list is kept. The runtime
  itself must follow the rule too: `platform/ios_ui.mm` calls
  `UIApplication.sharedApplication` and observes its notifications from
  `+load`, which an extension build has to leave out.
- **Integration.** The Expo plugin adds the target, and a CLI command adds
  it in a bare app. An App Group entitlement lets the app and its
  extension share storage.

An extension is its own process, with its own native root and module
state, so it never shares module variables with the app.

**Open:** how `lucent.json` declares a target, and whether a package or the
app owns it. Which modules the build includes: the import closure of the
principal class is the natural rule. A memory budget for the runtime,
since widget extensions run under tight limits.

### Worklet runtimes

**Planned** ([T134](../tasks.md#t134)). Worklets call Lucent modules, as
Nitro objects and Expo modules do on `react-native-worklets` runtimes.
Hosts are already per runtime, so each worklet runtime would get one,
with its calls' results and callbacks posted to its own scheduler.

**Open:**

- **Installing** on a runtime Lucent didn't create, without naming one
  worklet library in core. A generic install entry is the likely shape.
- **The main-thread rule.** The UI runtime runs on the main thread. A
  synchronous export called there must enter its actor as main-thread
  entries do, never with a ticket.
- **Instances across runtimes.** An instance belongs to the host that
  wrapped it, and `instanceOf` refuses another host's. Sharing one with a
  worklet needs a rule.

### JavaScript tasks from background entry points

**Blocked on a decision** ([T135](../tasks.md#t135)) on whether Lucent
offers it. An entry point would start React Native headless and run a
JavaScript function, as `expo-task-manager` does.

### App Intents, Live Activities and widget bodies

**Planned** ([T136](../tasks.md#t136)), after T131 and T133. App Intents
and ActivityKit attributes are Swift types that Xcode's tools read at
build time, so Lucent has to generate them from Lucent classes. A Live
Activity's body is SwiftUI JSX, as a widget's is. On Android, an
`AppWidgetProvider` written in Lucent (T131) renders `RemoteViews` it
builds through the SDK.

### Open decisions

Each becomes a decision record before its task's work starts:

1. Module state's lifetime with native roots, what a reload resets, and
   the three runtime rules above.
2. The entry-point ABI: names, sync and async forms, arguments, errors,
   scopes, and the API native code sees ([T114](../tasks.md#t114)).
3. Launch timing on each platform, and loading the code on Android.
4. Marking OS-instantiated Android classes, their constructors and names.
5. Checking background identifiers by rule.
6. Extension targets, their module set, their memory budget, and the
   runtime's own extension-unsafe calls.
7. Installing on worklet runtimes, which runtime owns an entry's work, and
   instances across runtimes.
8. Whether to offer JavaScript background tasks.
9. Generating App Intents and Live Activity types.

## Distribution

### One package and autolinking

Lucent ships as one npm package, `@lucent-lang/lucent`. It bundles the CLI
and the compiler in `dist/`, with the runtime's sources and the project
templates. It also holds the Metro integration, the Expo config plugin,
the Gradle scripts, the editor plugin and the JavaScript `lucent:core`.

`.lucent/native` is a React Native library, which autolinking links like
any other:

- **The app's entry.** `lucent init` adds
  `require("@lucent-lang/lucent/autolink")(__dirname)` to the app's
  `react-native.config.js`. It runs `lucent build` first when the package
  is missing or stale, as on a fresh clone or in CI.
- **iOS.** `LucentNative.podspec` builds it, and `LucentRegistration.mm`
  registers the TurboModule at load (`registerCxxModuleToGlobalModuleMap`).
  A second copy of Lucent fails loudly.
- **Android.** Its `react-native.config.js` declares a pure C++ TurboModule
  (`cxxModuleCMakeListsModuleName` and its siblings). Component
  descriptors are autolinked through `componentDescriptors`.

### Building with the app

- **Metro** bundles each `*.lucent.ts` module as a require of its proxy,
  and its watcher rebuilds as files change.
- **Android:** the Gradle scripts run a `lucentBuild` task before
  `preBuild`, and resolve the classpath that bindings read.
- **iOS:** no build phase runs `lucent build` yet. An Xcode build is current
  after Metro's watcher or `pod install` ran ([T141](../tasks.md#t141)).
- **Expo:** during `expo prebuild` the config plugin runs `lucent build`
  for the platforms prebuild writes, then links the native package. It
  writes the `Info.plist` keys and entitlements packages declare.
  **Planned:** the subscriber ([T110](../tasks.md#t110)), extension
  targets ([T133](../tasks.md#t133)) and package pods
  ([T141](../tasks.md#t141)).

### The release window

Lucent supports the stable Expo SDKs of the window and the React Native
releases from the oldest one's to the newest stable, with a prerelease
lane ([0074][d0074], [0079][d0079]):

| Lane       | React Native     | Expo SDK     |
| ---------- | ---------------- | ------------ |
| Window     | 0.85, 0.86, 0.87 | 56, 57       |
| Prerelease | 0.88 (candidate) | 58 (preview) |

`REQUIREMENTS` in `packages/lucent/src/cli/doctor.ts` holds the window,
which `lucent doctor` checks and the website's compatibility page shows.
The window moves when a stable release ships. Every release in it has each
React Native feature Lucent uses, so no fallback is generated. CI compiles
Lucent's React Native C++ against each release's headers and builds fresh
apps on each nightly; running them is [T140](../tasks.md#t140)'s.

### The prebuilt core

Releases ship the runtime's core prebuilt: the part that reaches no JSI,
React Native or fbjni header ([0059][d0059]). It is a static library per
Android ABI and an iOS xcframework (`scripts/prebuilt-runtime.ts`). An app
links it only when its hash matches the runtime's sources and flags, and
`LUCENT_RUNTIME_FROM_SOURCE=1` compiles from source instead. The JSI and
React Native glue stays source, since its ABI is the app's React Native's.

### Build identity

The native module embeds what it was built from (`emit/identity.ts`): the
runtime ABI, the target, a program hash, each module's API hash and the
React Native release. Proxies check it before calling, and a mismatch
names the rebuild or reinstall it needs. A body edit changes only the
program hash.

### Lucent packages

A Lucent package ships sources, never binaries, and an app compiles every
package into its one native package. `lucent.json` declares a package's
native needs: pods, Gradle dependencies, Swift packages, native sources,
resources, `Info.plist` keys, entitlements, manifest components and
extensions. They merge with each value's origin into `resolved.json`, and
a conflict names both packages.

**Planned:** the app's own `lucent.json` ([T111](../tasks.md#t111)), and
the web as a target for shared modules ([0077][d0077],
[T144](../tasks.md#t144)). On web, Metro resolves a proxy to the module
run as JavaScript. A module that uses a platform supplies a
`*.web.lucent.ts` twin.

## Build and tooling

- **One pipeline.** `build`, `check`, `dev`, Metro and the native build
  hooks share `buildProject()` (`packages/lucent/src/cli/pipeline.ts`).
  Each step is a record with its inputs, outputs, hash, status, timing and
  log (C-BUILD).
- **JavaScript dev mode** ([0060][d0060]). Metro can bundle modules as the
  JavaScript they are, so a body edit needs no native rebuild.
- **Diagnostics.** Each `LUCENT` code has one explanation
  (`packages/compiler/src/codes.ts`), shared by the CLI, the editor plugin
  and the website.
- **Tracing.** Traces correlate JavaScript entry, actor waits, native work,
  copies and build phases with `.lucent.ts` locations
  ([tracing.md](../tracing.md)).

<a id="18-implementation-slices-and-concrete-tests"></a>

## How work is sliced and tested

The plan lives in [tasks.md](../tasks.md), not here. Each task has a goal,
its needs, the checks it must pass, a checklist and a "done when"
([how to read a task](../tasks.md#how-to-read-a-task)). Dependencies are
the only ordering, and gates close on the integrated result. Every task
keeps the [requirements](../tasks.md#requirements), and an interface
several parts implement goes into [contracts.md](contracts.md) first.

Tests sit where a failure starts ([testing.md](../testing.md)):

| Layer             | Where                                                 | What it shows                                      |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Language          | `packages/compiler/test/e2e/cases/`                   | Native output equals the same source as JavaScript |
| Runtime           | `packages/runtime/test/`, plain and under sanitizers  | Races settle once; no leaks or data races          |
| Bindings and glue | bindgen and SDK suites; Android glue on a desktop JVM | Real SDKs bind; generated glue compiles and runs   |
| Apps              | `scripts/app-check.ts`, `scripts/device-check.ts`     | The example apps on the simulator and emulator     |
| Distribution      | `scripts/smoke-install.ts`, `scripts/window-app.ts`   | The packed package in fresh apps, on each release  |
| Performance       | `scripts/bench.ts`, `scripts/bench-build.ts`          | Budgets P1 to P9                                   |

The validation profiles V0 to V9, but V8 ([tasks.md](../tasks.md#validation)), name
the commands. Evidence keeps its level: code, host, simulator or emulator.
Physical devices are outside the plan ([0080][d0080]), and a check that
could not run is reported as not run, never as a pass.

The commit that does the work records it: the task's checklist, any
decision, a limitation found or lifted, and a changeset when users see the
change.

[d0005]: ../decisions/0005-the-native-platform-plan-and-the-no-catalog-rule.md
[d0006]: ../decisions/0006-the-kotlin-metadata-reader-is-typescript.md
[d0008]: ../decisions/0008-every-native-64-bit-integer-is-a-bigint.md
[d0010]: ../decisions/0010-swiftui-and-compose-are-written-in-lucent.md
[d0012]: ../decisions/0012-jsx-for-swiftui-and-compose-with-no-wrappers.md
[d0013]: ../decisions/0013-one-file-components.md
[d0016]: ../decisions/0016-the-ir-is-the-default-lowering.md
[d0027]: ../decisions/0027-native-views-jsx-derives-children-no-adapters.md
[d0045]: ../decisions/0045-a-built-in-is-exact-or-refused.md
[d0046]: ../decisions/0046-ports-keep-their-apis-views-share-state-the-main.md
[d0052]: ../decisions/0052-a-compiler-fault-is-a-diagnostic-at-its-function.md
[d0055]: ../decisions/0055-swift-asyncsequences-are-collected-as-flows-are.md
[d0057]: ../decisions/0057-exported-schemas-type-a-platform-without-its-sdk.md
[d0059]: ../decisions/0059-releases-ship-the-runtimes-core-prebuilt.md
[d0060]: ../decisions/0060-js-dev-mode-runs-modules-as-javascript.md
[d0063]: ../decisions/0063-a-value-only-its-own-local-sees-may-change-representation.md
[d0064]: ../decisions/0064-an-actor-per-package-and-the-main-thread-never-queues.md
[d0066]: ../decisions/0066-eventemitter-typed-like-expos.md
[d0069]: ../decisions/0069-native-errors-stay-errors-with-their-source-kept.md
[d0070]: ../decisions/0070-64-bit-parameters-take-safe-integer-numbers.md
[d0071]: ../decisions/0071-module-hooks-not-app-delegate-hooks.md
[d0072]: ../decisions/0072-weakmap-and-weakset-drop-entries-with-their-keys.md
[d0073]: ../decisions/0073-every-call-checks-the-stack-in-release-too.md
[d0074]: ../decisions/0074-a-window-of-stable-react-native-and-expo-releases.md
[d0075]: ../decisions/0075-instances-of-exported-classes-as-view-props.md
[d0076]: ../decisions/0076-an-app-delegate-and-activity-subscriber.md
[d0077]: ../decisions/0077-the-web-is-a-target-for-shared-modules.md
[d0078]: ../decisions/0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md
[d0081]: ../decisions/0081-functions-on-an-executor-share-only-constants-and-channels.md
[d0082]: ../decisions/0082-objects-go-on-an-executor-where-they-are-made.md
[d0079]: ../decisions/0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md
[d0080]: ../decisions/0080-the-plan-is-rewritten-for-parity-with-nitro-and-expo-modules.md

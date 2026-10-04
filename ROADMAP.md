# Lucent roadmap

Lucent compiles TypeScript modules and components to C++ that React Native
calls over JSI. This file is the project's plan and the record of its
status: what is done, what is next, the decisions behind it, and every open
task with its checklist. The website's
[roadmap page](https://lucent-lang.dev/docs/roadmap/) is generated from the
[status at a glance](#status-at-a-glance).

Updated 2026-10-01. A commit that finishes, changes or adds a task updates
this file in the same commit.

Related documents:

- [docs/design/native-platform.md](docs/design/native-platform.md): the full
  design specification behind the plan.
- [docs/design/contracts.md](docs/design/contracts.md): the shared
  interfaces (contracts) the parts implement against, with their versions.
- [docs/design/views.md](docs/design/views.md): the view design as built.
- [docs/architecture.md](docs/architecture.md),
  [docs/semantics.md](docs/semantics.md) and
  [docs/testing.md](docs/testing.md): how Lucent works today, the language
  it accepts, and how it is tested.

## Contents

- [Purpose and principles](#purpose-and-principles)
- [Status at a glance](#status-at-a-glance)
- [Architecture summary](#architecture-summary)
- [Decisions log](#decisions-log)
- [How to read a task](#how-to-read-a-task)
- [G1: Automatic binding ready](#g1-automatic-binding-ready)
- [G3: Wrapper preview ready](#g3-wrapper-preview-ready)
- [G4: Production candidate](#g4-production-candidate)
- [G5: Production recommendation](#g5-production-recommendation)
- [Done](#done)
- [Contracts](#contracts)
- [Validation](#validation)
- [Known limitations and deferred checks](#known-limitations-and-deferred-checks)
- [Design slices and tasks](#design-slices-and-tasks)

## Purpose and principles

**Write native behavior in TypeScript, import it from React, and let Lucent
handle bindings, compilation, integration and diagnostics.**

A module is a `.lucent.ts` file in a checked subset of TypeScript; a
component is a `.lucent.tsx` file. Lucent compiles both to C++ that runs
behind one C++ TurboModule. No JavaScript engine, Swift or Kotlin runs on
the native side except the Swift and Kotlin that Lucent generates. The
target is React Native's New Architecture on iOS and Android, in bare and
Expo apps; other platforms would need their own integration and gates.

The ambition is capability parity with Nitro and Expo Modules, excellent
performance, and a much smaller authoring model. Four promises shape the
work:

1. **One implementation is the spec.** Export ordinary functions, classes
   and components; Lucent derives the React-facing types and the native
   bindings from them. There are no separate module specs, registration
   names, event schemas or duplicated interfaces to maintain.
2. **Discover the installed native world.** No maintained catalog of SDKs,
   APIs, views or per-library bindings. Installing or upgrading a native
   dependency makes its public declarations available without a Lucent
   release.
3. **Make costs predictable.** Explain copies, thread transitions,
   ownership and rebuilds. Call overhead, computation, view responsiveness
   and development feedback are separate requirements.
4. **Finish real integrations.** Lifecycle, permissions, configuration,
   cancellation, packaging, debugging and upgrades are part of a native
   module, not extras.

Two supported paths reach native code: automatic TypeScript bindings for
every representable native declaration, and a typed extension path for
what metadata cannot express. Ordinary modules need no handwritten Swift,
Kotlin or C++. An opaque native library may need a small adapter, which
stays part of the same Lucent package and build.

### Requirements

These hold for every task. A task is not done by weakening one of them.

| Requirement                  | What it means                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No curated catalog           | APIs come from installed SDKs and resolved dependencies. No SDK, API or view catalog, central per-library override database or class-name allowlist. General ABI rules and the small platform integration surface (JSI, Fabric, view identity, JNI/ARC, app lifecycle) are allowed. Package-authored adapters are explicit and never become core registry entries. Test inventories are never allowlists. |
| JavaScript semantics         | The TypeScript-first authoring model and the semantics in [docs/semantics.md](docs/semantics.md) are the contract. Unsupported syntax or types fail with an actionable `LUCENT` diagnostic, never with invalid native code.                                                                                                                                                                               |
| Accepted toolchain decisions | Generated Swift and Kotlin shims are part of the design. Swift values cross as boxed references, Kotlin extension functions are receiver-first functions, and no Xcode or Swift minimum goes beyond React Native's.                                                                                                                                                                                       |
| Thread ownership             | JSI values stay on their runtime's JS thread; other threads hold `Host` ids. No raw JSI value in UI or worker state.                                                                                                                                                                                                                                                                                      |
| UI isolation                 | New UI execution never waits behind module computation. Views are not built on the legacy global lock with a promise to fix it later.                                                                                                                                                                                                                                                                     |
| Copy by default              | Arrays, objects and bytes keep their copy semantics. Fast buffers need explicit ownership; no implicit concurrent shared mutation.                                                                                                                                                                                                                                                                        |
| Generated code               | Everything is generated through `packages/codegen`. Every C++ build passes `-ffp-contract=off`. Evaluation order is explicit, coroutine frames own their captures and arguments, and JSI objects stay on the JS thread.                                                                                                                                                                                   |
| Repository rules             | [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md): differential e2e cases, runtime sanitizers, synchronized examples, changesets for user-visible changes, docs updated with behavior.                                                                                                                                                                                                        |
| Contracts first              | Shared interfaces are frozen as [contracts](docs/design/contracts.md) before several parts implement them. The product direction and acceptance gates change only by an explicit, recorded decision.                                                                                                                                                                                                      |
| Honest evidence              | Written code, host tests, simulator or emulator runs, physical-device runs and external use are different evidence levels. A missing device or toolchain is a blocked check, never a pass.                                                                                                                                                                                                                |

### Not planned

- Running JavaScript in native code: there is no JavaScript engine there.
- Reflection, `eval` and prototypes.
- Freeing reference cycles automatically. Cycles between Lucent objects, or
  between Lucent objects and the native objects that retain them as
  delegates or listeners, leak until they are broken; Debug builds report
  the native references left at teardown.

## Status at a glance

Lucent 0.1.0 is on npm as `@lucent-lang/lucent` (released 2026-09-30). It
contains the language, platform bindings with generated Swift and Kotlin,
isolated compute, native buffers, typed native extensions, the CLI, and
native views behind the internal `LUCENT_VIEWS=fabric` switch: UIKit and
Android views, and SwiftUI and Jetpack Compose bodies written as JSX.
One-file components landed on main after the release, unreleased.

Everything is tested on hosts, the iOS simulator and the Android emulator.
Nothing has run on a physical device yet: those checks are deferred to the
maintainer.

| Gate | Meaning                                      | Closing task | State             |
| ---- | -------------------------------------------- | ------------ | ----------------- |
| G0   | Dispatch ready: baseline and first contracts | T00, T01     | done (2026-09-25) |
| G1   | Automatic binding ready                      | [T28](#t28)  | in review         |
| G2   | View architecture proved                     | T44          | done (2026-09-26) |
| G3   | Wrapper preview ready                        | [T52](#t52)  | open              |
| G4   | Production candidate                         | [T67](#t67)  | open              |
| G5   | Production recommendation                    | [T70](#t70)  | open              |

What's next, in order of readiness:

1. [T28](#t28): prove automatic binding with unknown libraries (closes G1):
   in review; its binding gaps became [TA30](#ta30) to [TA34](#ta34).
2. [T48](#t48): JSX for any SDK view (in review); then [T49](#t49) and
   [T50](#t50).
3. [T52](#t52) with [TA25](#ta25) and [TA26](#ta26): wrapper ports and the
   views preview (closes G3; needs physical devices).
4. [T54](#t54) and [T60](#t60), which are ready and independent of the
   view work.
5. A scope decision on [T51](#t51), which as written conflicts with the
   decision against a cross-platform view vocabulary.

The website shows the following areas. Each line is one short sentence:
✅ done · 🚧 in progress · ⏳ next · 🔭 later.

### Foundations

Goal: A module runs as C++ in a bare React Native app and an Expo app, on iOS and Android.

- ✅ A C++ runtime with JavaScript's numbers, strings, arrays, maps, sets and errors.
- ✅ One C++ TurboModule, autolinked on iOS and Android.
- ✅ The compiler: the TypeScript checker, then C++ with `#line` back to the source.
- ✅ `lucent build`, the Metro integration and the Expo config plugin.
- ✅ Every language feature tested against the same code run as JavaScript.

### The language

Goal: Self-contained modules, such as parsers, codecs and data structures.

- ✅ Statements, expressions, destructuring and template literals.
- ✅ Object types, unions, narrowing, enums and generics.
- ✅ Classes with inheritance and interfaces, closures, generators, regular expressions and JSON.
- ✅ `async` and `await` off the JS thread, `AbortSignal`, JS callbacks and promises.
- ✅ `bigint`, with values of any size crossing to JavaScript exactly.
- ✅ `using` declarations and `Symbol.dispose`.
- ✅ Lucent code runs one piece at a time, so it has no data races.
- ✅ Heavy work on worker threads with `compute`, checked so a task shares no state.
- ✅ `NativeBuffer`, which hands bytes to tasks and JavaScript without copying them.

### Platform APIs

Goal: Call the iOS and Android SDKs directly from Lucent.

- ✅ SDK types read from your Xcode and Android SDK on first import, then cached.
- ✅ One module for both platforms, with platform branches; platform files as an option.
- ✅ Delegates, listeners and blocks; completion handlers as promises.
- ✅ Swift-only APIs, such as StoreKit 2 and CryptoKit, through generated Swift.
- ✅ Kotlin-only APIs, such as `suspend` functions and `Flow`, through generated Kotlin.
- ✅ Native 64-bit integers as `bigint`, so IDs and sizes stay exact.
- ✅ Callback APIs as promises and subscriptions, with `fromCallback` and `subscribe`.
- ✅ Members of generic classes on both platforms, such as `List<E>.get`.
- ✅ Classes extended in Lucent on both platforms, such as a `UIViewController`.
- ✅ OS version checks and main-thread-only APIs, checked at compile time on both platforms.
- ✅ The current `Activity` and iOS scene, activity results and permission requests.
- ✅ Libraries the app links: its pods on iOS, its Gradle dependencies on Android.
- ✅ Lucent packages on npm, with `lucent.json` for their native needs.
- ✅ Typed native extensions: C code a package ships, checked against its header.
- ✅ A coverage report of what each SDK binds, and why the rest is skipped.
- ✅ Pinning the SDKs a project uses, and listing what an SDK update changes for your code.
- ✅ Ports of Expo and community modules, checked against the originals.
- 🚧 Native libraries nobody has seen before, bound and run with no change to Lucent.
- 🔭 Weak references.
- 🔭 Binding the APIs of Swift Package Manager libraries.

### Views

Goal: Native views from Lucent components, rendered by React Native's Fabric.

- ✅ Components in `.lucent.tsx` that render UIKit and Android views, behind an internal switch.
- ✅ SwiftUI and Jetpack Compose bodies written as JSX, from declarations read from your SDKs.
- ✅ One file per component, with each platform's body in a platform branch.
- ✅ Events, commands, requests that answer, recycling, sizing to content and React children.
- ✅ Views that keep updating while JavaScript is blocked.
- 🚧 JSX for any SDK view, keyed lists and Yoga layout.
- ⏳ A views preview with wrapper ports, such as maps, web views and video.
- 🔭 Native lists, gestures and animations, and media pipelines.

### Production

Goal: Ready for apps in production.

- ✅ `@lucent-lang/lucent` on npm, published from CI with provenance.
- ✅ Incremental builds, and rebuilds as you edit, including linked packages.
- ✅ Crashes and errors that point at `.lucent.ts` lines.
- ✅ Lucent's errors in the editor.
- ✅ A warning when the installed app runs an older native build than your code.
- ✅ A JavaScript `lucent:core`, so Jest and Vitest can run shared modules.
- 🚧 Performance budgets in CI.
- ⏳ Testing on physical devices; today, simulators and emulators.
- 🔭 Background tasks, services and app extensions with no live JavaScript.
- 🔭 A tested support window of React Native and Expo versions.
- 🔭 Pilots with independent library authors and real apps.

## Architecture summary

This is the design in brief, as built and as planned. The full
specification, with examples, call-direction tables, race cases and test
scenarios, is [docs/design/native-platform.md](docs/design/native-platform.md);
the code-level description of what exists is
[docs/architecture.md](docs/architecture.md).

### From source to native code

```text
Installed SDKs and linked dependencies ──► metadata readers ──► binding schema
                                                                    │
.lucent.ts / .lucent.tsx ──► TypeScript checker ──► analysis ──► lowering
                                                    (effects,      │
                                                     owners)       ▼
                                   codegen ASTs: C++, ObjC++, Swift, Kotlin, Java, TS
                                                                    │
            .lucent/native: runtime, generated C++, shims, podspec, CMake, JS proxies
                                                                    │
                              one C++ TurboModule over JSI, Fabric components
```

- **Compiler.** The TypeScript checker types the program (strict, with
  `noUncheckedIndexedAccess`). An analysis computes effects, owners,
  captures and borrows for the whole program (`ProgramFacts`), so
  compute tasks and views are checked against facts rather than
  signatures. Lowering produces syntax trees from `packages/codegen`, one
  per output language, which printers write out; the emitters do not build
  source text from strings. A semantic IR with a verifier carries the whole
  language: every function, method, constructor, module `init()`, compute
  task variant and component setup lowers through it, with what it does
  not model itself (member access, builtin and SDK calls) as plans the
  emitter's leaf code writes.
- **Order and numbers.** Evaluation order is explicit in the generated C++
  (one statement per ordered operation), never left to C++ argument order.
  Every build passes `-ffp-contract=off`, because JavaScript rounds
  `a * b + c` twice.
- **Native package.** `lucent build` writes `.lucent/native`: the runtime,
  the generated C++, Swift and Kotlin shims, the podspec and CMake files,
  the registration code and the JavaScript proxies. Only changed files are
  rewritten, and generated files are replaced whole. The Metro transformer
  swaps each Lucent module for its proxy; the Expo config plugin and a
  Gradle task run the build.
- **Runtime.** A dependency-free C++ runtime implements JavaScript's
  values: numbers, UTF-16 strings, arrays, maps and sets, errors, bytes,
  `BigInt`, `Date`, `RegExp` and JSON. A thin JSI layer converts values at
  the boundary and keeps every JSI object on its JS thread.

### Bindings

- **Discovery.** Declarations come from the actual build graph: SDK
  modules, Clang headers, Swift symbol graphs, JVM classfiles, Kotlin
  metadata (read by a TypeScript decoder) and the app's pods and Gradle
  dependencies. Names are indexed cheaply and extracted on import; caches
  are keyed by content, target, extractor and schema version, and are
  published atomically.
- **Schema.** Each symbol has a native identity separate from its
  TypeScript name, plus provenance (artifact, target, extractor). Facts
  such as thread affinity, blocking, callback timing and ownership default
  to unknown and carry their evidence; nothing is inferred from a name.
- **Binding plans.** Type and ABI rules turn each member into a plan of
  conversions (copy, retain, box a Swift value, optional, tagged union,
  out-parameter, callback trampoline, error, `bigint`) for one backend:
  Objective-C, JNI, Swift shim, Kotlin shim or C ABI. Both the `.d.ts`
  declarations and the native code come from the same plan, and a refused
  shape carries the reason shown in diagnostics and coverage.
- **Swift and Kotlin.** Swift-only APIs go through generated `@_cdecl`
  shims, with Swift values boxed; `async` becomes a promise. Kotlin-only
  APIs go through generated Kotlin, with `suspend` as a promise whose
  coroutine is cancelled with its operation, defaults left out natively,
  and extensions as receiver-first functions.
- **No catalog.** Behavior is never selected by a library or class name.
  `await` on a native object is refused (`LUCENT1010`); `fromCallback` and
  `subscribe` turn any listener into a promise or a subscription.
  Libraries whose behavior metadata cannot express use a typed native
  extension: a C header plus a contract in `lucent.json`, checked against
  the header.
- **Exact integers.** Every native 64-bit integer crosses as `bigint`.
- **Tools.** `lucent sdk coverage` reports each member's stage
  (discovered, representable, generated, exercised) with reasons;
  `lucent sdk lock` and `--frozen` pin the SDKs a project builds against,
  and `lucent sdk diff` lists what an upgrade changes for the symbols the
  code uses.

### Execution and ownership

| Context         | Runs                                                                   | Rules                                                                 |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Module (legacy) | Exported functions and their async continuations, on the Lucent thread | One fair global lock (`LucentLock`) serializes module code, as before |
| Main            | Views, their effects and commands, main-thread SDK calls               | Never takes the module lock; runs on the platform's UI loop           |
| Compute         | `compute(task, input, { signal })`                                     | A bounded worker pool (cores − 1); checked tasks share no state       |

- A promise resumes on the context that created it; a result from another
  thread is posted there. No context ever waits synchronously for another.
- Every pending operation carries a token (runtime, scope, generation,
  operation). Scopes dispose children, cancel operations and run cleanups
  in reverse order exactly once; a token from a disposed or recycled scope
  never revives it.
- Each JS runtime has its own `Host`. Reload invalidates it, cancels its
  work and rejects its promises while JavaScript can still observe them.
- `compute` runs a top-level function on a snapshot of its input. The
  compiler rejects tasks that touch module state, main-thread or unknown
  native code, or untracked functions (`LUCENT3011`), and inputs or
  results that are not data (`LUCENT3012`), naming the path.
- `NativeBuffer` holds bytes natively. `withRead` and `withWrite` lend
  scoped spans that cannot escape (`LUCENT3030`); `transfer()` and
  `compute` move ownership, and use after a move is reported
  (`LUCENT3031`). `Uint8Array` keeps its copy semantics.

### Views

A component is an exported function of a `.lucent.tsx` module. Its setup
runs once per mount on the main thread; React sees an ordinary component
with typed props, callback props for events, and a ref whose methods are
the commands the setup exposes. The design record is
[docs/design/views.md](docs/design/views.md).

- **Fabric.** Each component gets generated props, event emitter, shadow
  node and descriptor. iOS registers a `LucentComponentView` subclass per
  component; Android generates a manager per component around a shared
  host view, listed by `LucentPackage`.
- **Reactivity.** Props arrive as whole-commit transactions. `signal` and
  `effect` form a UI-owned graph: dependencies are tracked on each run,
  cleanup runs before a rerun, and effects never see half an update.
- **Events and commands.** Events are typed slots; a callback prop's
  JavaScript function stays on the JS thread. Events are discrete,
  `Continuous` or `Coalesced`. A void command runs on the main thread; a
  request returns a promise answered once per mount.
- **Sizing and children.** A constrained host fills its content box;
  intrinsic sizes are measured on the UI thread and exchanged through
  Fabric state, keyed by bounds, font scale and direction, with stale
  results rejected. React children go into one slot per component: Fabric
  owns the children and their frames, the host owns their placement.
- **SwiftUI and Compose in Lucent.** A component can return its platform
  toolkit's JSX. `lucent:swiftui` is generated from SwiftUI's interface in
  the installed Xcode, `lucent:compose` from the Kotlin metadata of Compose
  and Material 3. The body is emitted as a Swift `View` or a Kotlin
  `@Composable`; values it reads from the logic are pushed into
  `@Published` or snapshot state, and the functions it calls run Lucent
  code. SwiftUI attributes named like an initializer label are arguments;
  the others are modifiers in source order, with a trailing chain for a
  repeated modifier. Compose composition calls stay plain statements that
  the compiler moves into the composable. Helper view functions become
  `fileprivate` Swift views or `@Composable` functions.
- **One file per component.** The logic is written once and each
  platform's body sits in a `PLATFORM` branch; named imports from both
  toolkits are aliased on a clash. Split `*.ios.lucent.tsx` and
  `*.android.lucent.tsx` files remain supported.
- **Hosts.** SwiftUI bodies live in a `UIHostingController` contained
  before it appears, sized from its parent, with RTL from the layout
  direction. Compose bodies live in a composition with view-tree owners, a
  saved-state registry per mount and disposal at mount end.
- **Isolation.** Simulator and emulator runs showed native updates
  continuing through a 3 s JavaScript block, a 500 ms compute task and
  module code holding the lock; an iOS trace showed no main-thread waits
  on Lucent's lock.

### Build and tooling

- **One pipeline.** `build`, `check`, `dev`, Metro and the native build
  hooks share `buildProject()`. Each step is recorded with its inputs,
  outputs, hash, status, timing and log, in a schema-versioned manifest.
- **Required actions.** A build reports what the app needs next: reload
  JavaScript, recompile native code, repackage resources, relink
  dependencies or reinstall. `lucent dev` watches Lucent packages outside
  the app too, never rebuilds for its own output, and drops a build a newer
  change made stale.
- **Stale native code.** The native module embeds its build identity
  (runtime ABI, public API hash, native program hash) and the proxies
  embed the identity they expect. A mismatch names the rebuild or
  reinstall needed. JavaScript-only edits stay compatible.
- **Tracing.** Correlated traces cover JS entry, owner queues, native work,
  copies and build phases, with `.lucent.ts` locations through generated
  frames.
- **Packages.** Lucent packages ship sources; an app compiles one runtime.
  `lucent.json` declares pods, Gradle dependencies, Swift packages,
  vendored frameworks and libraries, native sources, resources,
  entitlements, manifest components and targets, merged deterministically
  with the origin of each value.

### Performance budgets

<a id="performance-budgets"></a>

Host budgets are enforced by `node scripts/bench.ts --check` (kernel
speedups, boundary batching, and a host-call floor of 1.25x a handwritten
C++ TurboModule). CI's shared runners enforce the kernels' budgets and
report the boundary and floor ratios, which move with the CPU
(`--shared-runner`); a stable machine enforces them all. The design's device budgets are targets until physical
devices measure them; a missed target is recorded and decided, never
quietly weakened.

| Id  | Dimension           | Workload                                          | Gate                                                                                        | State                                              |
| --- | ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| P1  | Primitive calls     | Boundary `add` and `concat`, 1,000 calls          | Within 1.25x a bare host function (host); within 20% of the fastest framework path (device) | Host checked; device open (T65)                    |
| P2  | Computation         | The benchmark kernels                             | No regression of the kernel budgets; within 20% of handwritten native for selected kernels  | Host checked; native references open (T54, T65)    |
| P3  | Binary transport    | `NativeBuffer` handoff of 1 KB, 1 MB and a stream | No payload copy on owned handoff; copies and allocations counted                            | Implemented (T31, T32); device open                |
| P4  | View frames         | A steady-state wrapper workload                   | p95 frame work within 16.7 ms (60 Hz) or 8.3 ms (120 Hz), under 1% missed                   | Open (T65, devices)                                |
| P5  | UI isolation        | Busy JavaScript plus a 500 ms compute task        | No equivalent UI stall; lock and queue waits reported                                       | Simulator and emulator evidence (T44); device open |
| P6  | Teardown and memory | 1,000 mount/dispose and subscribe/cancel cycles   | Owned counts return to baseline, no retained growth                                         | Open (T64)                                         |
| P7  | Feedback            | A fixture app's edit loop                         | p95 warm diagnostics under 500 ms; check and generation under 1 s                           | Warm check measured at 0.3 s; open (T61)           |
| P8  | Startup and size    | Empty app, one module, one view, many packages    | Budgets set at first measurement                                                            | Open (T62, T65)                                    |
| P9  | Reliability         | Sanitizers and stress                             | No use-after-free, deadlock or cross-thread JSI access                                      | Host sanitizers clean; stress open (T64)           |

Benchmarks keep raw samples, report median, p95 and p99, separate
throughput from latency, interleave implementations after warmup, verify
outputs, and rerun noisy threshold crossings before calling a regression.

## Decisions log

Decisions that shape the plan, newest first. Each one records what was
decided, why, and what it changed. A decision changes only by a new entry.

**2026-10-04: Native views' JSX derives children; no adapters.** A view
class takes JSX children through the insert-at-index method its
declarations give (`insertArrangedSubview:atIndex:`,
`insertSubview:atIndex:`, `addView(View, int)`); the design's
package-authored `defineChildAdapter` was dropped. A JSX element is the
toolkit's view and the platform's root view at once (`View & UIView`), so
native JSX is returned from a component declared as returning the root
view. _Why:_ an adapter was machinery each component repeated for what the
declarations already say, and children are as derivable as props and
events; the intersection keeps one JSX namespace per platform file.
_Changed:_ T48's scope (children by rule, no adapter API), C-VIEW v2.3,
and design 16.5's note.

**2026-10-03: Android glue runs on a desktop JVM in tests.** T28 executes
an unknown Android library through Lucent's real JNI glue on a JVM the
test starts (the desktop JNI host), not on an emulator: `android.cpp`'s
JNI also builds with `LUCENT_JNI_HOST`, and the host supplies the thread's
`JNIEnv`, the main thread and stand-ins for the two Android classes
Lucent's Java reads. _Why:_ it runs in CI on any machine with a JDK, in
seconds, and catches JNI mistakes (`-Xcheck:jni`); an emulator run needs
the Android build and a device. _Changed:_ views still need Android to
mount, so an Android view's glue is compile-checked there; the emulator
remains the example apps' check (V5).

**2026-10-03: CI reports the boundary and floor ratios, a stable machine
enforces them.** On CI (`bench.ts --check --shared-runner`) the budgets
that compare one crossing with another (the boundary's batched cases
against 1,000 calls, one call against a C++ TurboModule's) are printed
with the runner's CPU and raised as warnings, not failures; the kernels'
speedups against JavaScript, on the same machine and with wide margins,
still fail the run. _Why:_ GitHub's runners differ in CPU from run to
run, and those ratios with them: the same commit measured `structsIn1000`
at 1.6x and 2.2x (budget 1.75x), so the job failed by the machine drawn,
not by the code. _Changed:_ the budgets themselves are unchanged and
`--check` without the flag enforces them all, as on the development
machine and the integration gate.

**2026-10-03: CI aims at ten minutes.** Every job runs on its own, most
under five minutes: the unit tests in two Linux and three macOS shards
balanced by each file's time (`test-timings.json`), each compiled-code
harness (e2e, budgets, each app check) in a job, the SDK coverage and
the libc++ runtime beside the app builds. C and C++ compile through
ccache (the PATH's compilers on Linux, React Native's wrapper on iOS,
CMake's launcher on Android), saved from main's runs and read by pull
requests; each job keeps its own SDK cache; the app checks keep Gradle's.
At most five macOS jobs run at once, as many as the account allows.
_Why:_ the two long jobs took about an hour, and the parallel jobs then
waited on cold caches and on macOS runners. _Changed:_ on the run of
2026-10-03 every job but the iOS app's took 1 to 8 minutes; that one took
16, extracting the SDK into its first cache of its own and compiling
without a warm ccache, which later runs have.

**2026-10-03: A build that leaves Android out defers its dependencies.**
`lucent build --platforms ios` (or `host`) types Android's imports of the
app's dependencies only once a Gradle build has resolved the app's
classpath; before that they are untyped, named in a warning that points
to the Android build, as for an Expo app before `expo prebuild`. _Why:_
such a build skips the resolution, so it failed with LUCENT3004 on a fresh
checkout (seen on CI building the bare example for iOS alone), though
nothing it builds reads those modules' types. _Changed:_ a build that
includes Android resolves them with Gradle as before, and reports a
failed resolution.

**2026-10-03: `pnpm test` leaves out the slow tests on a workstation.**
The tests that build and run whole programs with the platforms'
toolchains (Swift and JVM host runs, Mac Catalyst and Hermes view runs,
Gradle) or extract an SDK into an empty cache are listed in
`vite.config.ts`; `pnpm test` skips them, saying so, and `pnpm test:all`
and CI (`CI` set) run them. _Why:_ they set the edit-test loop's length
(minutes where the others take seconds) and rarely fail for a change
that is not theirs. _Changed:_ V1 and the integration gate run
`pnpm test:all`.

**2026-10-03: CI runs its long work side by side.** Linux has three jobs
(unit tests; the runtime and JSI host tests; e2e, budgets and app
checks), and macOS runs the tests that need the iOS SDK in two shards
beside the app build; two local actions set the workspace up and
restore or build Hermes. The harnesses build in parallel too: the
runtime tests compile the runtime once for all their binaries, e2e
builds its cases side by side, and the Swift and Catalyst harnesses
share the SDK cache and the runtime's objects. _Why:_ the two long jobs
took about an hour each, step after step, and most of it was the same
work done again (the runtime compiled for every test binary, the SDK's
symbol graphs extracted for every Swift program, framework names read
from the cache thousands of times per compile). _Changed:_ on an 11-core
Mac the runtime tests went from 426 s to 26 s, e2e from 424 s to about
40 s, and the unit tests from 588 s to 495 s (5,374 s to 4,618 s of
work); the checks and what they cover are the same.

**2026-10-03: Separate the marketing homepage from the docs shell.**
The reviewed Voltage design is a dedicated Astro page; Starlight continues
to provide docs, search and the mobile drawer. _Why:_ the homepage needs
its own layout while docs retain their navigation and reading tools.
Sidebar titles wrap in full rather than relying on truncated hover text.

**2026-10-03: The `structsIn1000` budget is 1.75x.** Passing 1,000
`{x, y}` structs may cost up to 1.75x as much as 1,000 `add()` calls,
up from 1.5x. _Why:_ it measured 1.38–1.45x on the development machine
(Apple silicon) and 1.63–1.67x on the x64 Linux CI runner, before and
after the IR. A profile puts about a third of it in two JSI
`getProperty` reads per struct, which Hermes serves without a property
cache, and most of the rest in reading each element and allocating its
struct: the conversion's own work, whose cost against a host call
depends on the CPU. Moving each loop element instead of copying it
(2026-10-03) removed the one avoidable cost found. 1.75x still fails a
real regression: the conversion cost 3.2x before T10's optimizations.
_Changed:_ `scripts/bench-boundary-budgets.json`; the other boundary
budgets are unchanged.

**2026-10-02: Component setups lower through the IR.** A setup is
lowered as functions are, its mount an ambient value of the IR that the
functions it makes capture and enter (`closure.enters`), and a toolkit
body's slots thunks: closures of each slot's expression, which the
effects the toolkit code writes call. _Why:_ the setup's code is the
program's, so it gets the IR's order, captures and verification; the
toolkit glue keeps only what no TypeScript expression says (the host,
the effects, the encoding). _Changed:_ the emitter's statement lowering,
its lambdas over the setup's locals and its own evaluation-order helpers
are removed: the IR orders evaluation, and leaves are expressions.

**2026-10-01: The legacy emitter's function paths are retired.** Only the
IR lowers functions, methods, constructors, modules' `init()` and task
variants; `LUCENT_LOWERING` and its fallbacks are gone, and what the IR
cannot lower is a LUCENT diagnostic. _Why:_ the IR carries the whole
corpus with the same results, so a second path only hid gaps. _Changed:_
component setups still lower their statements with the emitter's code
until the view work moves them onto the IR.

**2026-10-01: The IR is the default lowering.** Every function, method,
accessor, constructor, module `init()` and compute task variant compiles
through the semantic IR; the legacy emitter remains selectable
(`LUCENT_LOWERING=legacy`) for comparisons until its paths are removed,
and still writes component setups (behind `LUCENT_VIEWS`). _Why:_ the IR
lowers the whole e2e corpus and both example apps, with the same
results, diagnostics and performance budgets. _Changed:_ generated C++
reads differently (values named `v3_`, parameters `p0_`), which the
codegen corpus baseline has to take.

**2026-10-01: The IR plans leaves with the emitter's code.** What the IR
does not model itself (a member read, a builtin or SDK method, a
construction, a literal of an array or object) is a `plan` operation on
values the IR computed first, in order; its C++ comes from the emitter's
existing code for that leaf, its subexpressions being named values.
_Why:_ the builtin and SDK semantics are some 5,000 lines; writing them
again for the IR would duplicate them, and the IR's job is order,
control flow, places, closures, exceptions and suspension, not the C++
spelling of each runtime call. _Changed:_ T53 migrates by moving
structure into the IR and keeping leaves where they are; once every
function goes through the IR, the emitter keeps its leaf code and loses
its statement and ordering code.

**2026-10-01: Publish the plan.** The native-platform plan was private
during execution. It is now public: task IDs, contracts and decisions,
with this file as the single source of truth. _Why:_ the work needs to be
tracked in the open, with GitHub milestones and issues for the gates.
_Changed:_ the plan, the earlier status files and the old TODO list are
folded into this file; the contracts and the design specification are
published under `docs/design/`.

**2026-09-30: One-file components.** A component is one `.lucent.tsx`
file: its logic once, its SwiftUI body and its Compose body in `PLATFORM`
branches. Named imports from both toolkits are aliased when they clash.
Split platform files stay supported. _Why:_ the logic is written once
instead of once per platform. _Changed:_ the toolkits' names are platform code (`LUCENT3024` outside
their branch), and a body for one platform only is `LUCENT3023`.

**2026-09-29: JSX for SwiftUI and Compose, with no wrappers.** A
component's body is the JSX it returns, found by type; there is no
`swiftUI()`, `compose()` or `native()` wrapper. Compose's composition
calls stay ordinary statements, which the compiler moves into the
composable. SwiftUI modifiers are attributes in source order, with a
trailing chain for repeats; an attribute named like an initializer label
is an argument. Imports target one platform's toolkit; there is no common
interface. _Why:_ the wrappers were ceremony: removing `native()` showed
it did nothing a direct construction does not. _Changed:_ this replaced the 2026-09-26 call-form
syntax; `native()` was removed.

**2026-09-28: Releases are squashed onto main.** The view-wave release
went to main as one squashed commit; work continues on branches from main.
_Why:_ the integration history named private task IDs, which were not
public then. _Changed:_ the 0.1.0 release (pull request #13) reached main
as one commit.

**2026-09-26: SwiftUI and Compose are written in Lucent.** Views have no
per-platform native code to write. SwiftUI and Compose are bound as they
are (`lucent:swiftui`, `lucent:compose`); bodies become generated SwiftUI
and `@Composable` source; logic stays C++ behind the Swift and Kotlin
shims; signals map to the toolkits' observable state; animations use each
platform's own APIs from TypeScript. There is no cross-platform view
vocabulary. _Why:_ the goal is no per-platform native code for the
author to write, and, without a shared vocabulary, each toolkit is written
the way its vendor documents it. _Changed:_ this overrides the design's
section 16.8 ("Lucent does not translate SwiftUI or Compose bodies").
T57 and T58 became the host layers (containment, lifecycle, sizing,
disposal) for generated content instead of factory hosts. The first
syntax, a call form inside `swiftUI(() => …)` and `compose(() => {…})`,
was replaced on 2026-09-29.

**2026-09-26: Views are done when SwiftUI and Compose are done.** The view
release was defined as complete through the SwiftUI and Compose hosts
(T57, T58), with physical-device checks still deferred. Then the work was
released to main and the remaining tasks waited for the maintainer.
_Why:_ the maintainer set the release's scope this way; the record gives
no further reason. _Changed:_ T38, T39, T43 and the T44 spike led to T45,
T46, T47, then T57 and T58; released as 0.1.0 on 2026-09-30.

**2026-09-25: Every native 64-bit integer is a `bigint`.** Java `long`,
`int64_t`, `uint64_t`, `NSInteger`, `NSUInteger` and Swift `Int`, `Int64`
and `UInt64` cross as `bigint`, exactly; a value the native type cannot
hold throws `RangeError` naming the parameter or field. Enums, option sets
and `@IntDef`/`@LongDef` groups stay numbers. _Why:_ IDs, sizes and
sentinels such as `NSNotFound` and `Long.MAX_VALUE` must never be
narrowed silently through `number`. _Changed:_ added the language's
`bigint` and tasks TB1–TB4; it replaced the earlier rule (exact within
±(2^53 − 1), `RangeError` beyond). Code passing numbers to these APIs must
pass bigints.

**2026-09-25: Physical-device checks are deferred.** Physical-device
checks (V8) and StoreKit `purchase()` run in a later session by the
maintainer. They are recorded as deferred, never as passed; dependent
tasks continue on simulator, emulator and host evidence and keep the
deferred item listed. _Why:_ no device was available (the iPhone was
offline, and no midrange Android phone was connected), and `purchase()`
needs a StoreKit configuration that only Xcode-launched runs apply.

**2026-09-25: The Kotlin metadata reader is TypeScript.** Lucent ships its
own TypeScript decoder; the official JVM library is the test oracle.
_Why:_ measured on 4,417 real declarations, the two agreed exactly, while
the JVM reader would add 2.8 MB of jars, a prebuilt helper and JDK
discovery to a 0.78 MB CLI. The decoder adds 14 KB and is faster.

**2026-09-24: The native platform plan and the no-catalog rule.** Lucent
aims at a complete native platform (the design specification), and
dynamic discovery is an invariant: no maintained catalog of SDKs, APIs,
views or per-library bindings. _Why:_ installing or upgrading a native
dependency must not need a Lucent release. _Changed:_ the full SDK plan's
Lucent-owned API notes were dropped (metadata and adapters provided by a
project or package stay allowed), and named awaitables were removed
rather than moved into such notes.

**2026-09-24: Full SDK plan.** Swift values cross as boxed references
only; Kotlin extension functions are receiver-first functions, never
methods; Swift shims need no Xcode or Swift beyond React Native's. A
private `packages/codegen` with a full syntax tree per language replaced
string templates in every emitter; the one-line edits to Gradle, podspec
and keep-rule templates stay line edits. `@IntDef` arguments outside
their group warn (`LUCENT3008`) instead of narrowing the parameter's type.
_Why:_ these answered the plan's open questions; the codegen package came
first so that everything after it, the Swift and Kotlin shims included,
generates code through it.

**2026-09-24: CLI and package.** One published package,
`@lucent-lang/lucent`. The terminal UI uses Ink, loaded lazily; `lucent
dev` runs in its own terminal while `withLucent` prints compact lines in
Metro's; the six old packages are only deprecated. _Why:_ one install,
fast `--help`, and no takeover of Metro's keys.

**2026-09-24: Docs.** The tutorial is the trip tracker; only the latest
docs are published until 1.0; where the plan and the code disagree, the
docs describe the code. _Why:_ docs must stay true to what ships.
(The first decision, typed TypeScript page objects instead of MDX, was
replaced when the website moved to Astro Starlight on 2026-10-01; the
reference pages are still generated from typed templates, and Vale checks
every page.)

**2026-09-23: Improvement plan.** One reflection-based `NativeProxy` for
every Java interface, measured before generating classes; single-file
platform branches as the standard way to write platform code; packages
ship sources only; SDK member names come only from the member's own
signature. Bind the types apps commonly use, not every type: the "under
1% unrepresentable" target was dropped, and the coverage report is a
regression check that CI enforces.

## How to read a task

Each open task below has a stable anchor (`ROADMAP.md#t28`) that issues
link to, a one-sentence goal, then:

- **Status:** ready to start when every dependency is done.
- **Area:** where the work sits: bindings, compiler, runtime, views, the
  Apple or Android host, tooling, or verification.
- **Needs:** the tasks it depends on, with their state. Dependencies are
  the only ordering; task numbers and gates add none.
- **Verify:** the [validation profiles](#validation) the work must pass.
- **Where:** the code or artifacts it changes.
- **Needs the maintainer:** checks that need physical devices or pilot
  participants, which an agent cannot provide.

The checklist is the acceptance criteria; **Done when** is the condition
that closes the task. "Carried over" items come from finished tasks or
earlier plans. A task is checked off only when its criteria pass on the
integrated result.

<a id="g1-automatic-binding-ready"></a>

## G1: Automatic binding ready

A native library Lucent has never seen binds and runs end to end by rule,
with no change to Lucent. The gate closes with T28's evidence: randomized
fixture libraries, a new artifact version and a transitive dependency,
extracted, type-checked, compiled and executed on both platforms.

T28's evidence passes on its branch, so this gate closes when it merges.
Scoped native work may continue before it closes.

| Task        | Title                                                  | Needs | Status    |
| ----------- | ------------------------------------------------------ | ----- | --------- |
| [T28](#t28) | Prove automatic binding with unknown fixture libraries | —     | in review |

The Needs column lists only open dependencies.

<a id="t28"></a>

### T28: Prove automatic binding with unknown fixture libraries

**Goal:** Show that a native library Lucent has never seen binds and runs
end to end by rule, with no change to Lucent.

- **Status:** in review (2026-10-03): every item below passes on its
  branch.
- **Area:** Verification, with a bindings review.
- **Needs:** T11 (done), T13 (done), T17 (done), T25 (done), T26 (done), T27
  (done).
- **Verify:** V1, V4, V5.
- **Where:** Generated, randomized native fixtures and the capability
  evidence.

- [x] Build Lucent first, then generate and install fixtures with randomized
      module, class, callback, generic and async declaration names.
      `packages/compiler/test/unknown-library.test.ts` copies
      `fixtures/unknown-library` under a prefix drawn at random on every
      run (file, module, package and member names): Swift modules and an
      Objective-C view on iOS, Kotlin jars and an `android.view.View`
      subclass on Android.
- [x] Extract, type-check, emit, compile and execute their APIs without
      changing Lucent; repeat for a new artifact version and for a
      transitive dependency. A class hierarchy, a callback implemented by
      a Lucent class, a generic wrapper, an async (`suspend`) method that
      succeeds and throws, and a type from a dependency in its own module
      or jar run on the macOS host (iOS) and on a JVM through the JNI glue
      (Android, the desktop JNI host), with the same output. The iOS view
      mounts on Mac Catalyst (props, an event, a command, release); the
      Android view binds and its glue compiles. A new version installed in
      place binds in the same process, and only the changed member's shim
      changes.
- [x] Assert that supported shapes need no framework-specific override, and
      that unsupported shapes get precise diagnostics naming the raw API or
      the extension path. Nothing in Lucent names the fixtures. A member
      the new version dropped names its module and artifact
      (`swift-module:…`, `pod:…@version`); a skipped one (a tuple) says it
      exists, why it is not bound, and to wrap it in Swift or Kotlin of the
      app's own; a refused one (a returned function, LUCENT2002) names its
      symbol and artifact with the same fix; a type only named in another
      module's signatures says to import its module.
- [x] Record the G1 evidence, and turn the remaining type-shape gaps into
      explicit tasks (start from the known gaps below): [TA30](#ta30) to
      [TA34](#ta34).

**Done when:** unknown names work end to end by rule. Passing only schema
snapshots, or renaming a class that is already handled, is not enough.

**Notes:**

- Found and fixed on the way: a process resolved a platform's artifacts
  once, so `lucent dev` and the editor kept a library's old API after a
  `pod install` (now once per build); a missing member was TypeScript's
  error alone; Android's JNI runtime reading a `Throwable` skipped
  exception checks between calls (HotSpot's `-Xcheck:jni` reports it; the
  desktop JNI host runs with it).
- New gaps: a Kotlin function type is bound as the `Function1` class; a
  property of an interface type takes no Lucent function, and a view may
  not give it an object either, so a view cannot set one (both
  [TA30](#ta30)); a class whose superclass's module is only named gets a
  misleading error for its inherited initializers ([TA33](#ta33)).

- The fixture, from the design's acceptance scenario: a random namespace, a
  class hierarchy, a callback interface, a generic wrapper, a view subclass
  and a native async method. Change its version and add or remove a used
  method; check cache invalidation, stable unaffected names and an
  actionable missing-member diagnostic. Execute at least one call, one
  callback and one view.
- Known gaps, now tasks. From T26 ([TA31](#ta31)): Kotlin shims refuse generic members,
  Lucent functions passed as `suspend` functions, assigning value classes,
  and implementing such members; defaults are not optional for generic
  members. From T11 ([TA32](#ta32)): Swift Package Manager modules are not
  discovered (packages can declare and link them), the iOS target used for
  extraction is fixed rather than read from the project, and
  `use_frameworks!` with dynamic linkage is not built ([T62](#t62)). From
  T25 ([TA34](#ta34)): a `lucent:android` helper turning a `Throwable` into
  the `Error` a thrown one becomes would let adapters keep the error's
  `code`. From the improvement plan (2026-09-23, not rechecked since,
  [TA33](#ta33)): factory initializers that Swift imports as `init` are
  dropped by the extractor, and functions Swift imports as members of
  CoreFoundation-style handles (`cgImage.width`) are not bound.

<a id="g3-wrapper-preview-ready"></a>

## G3: Wrapper preview ready

Native views become a usable, validated preview: JSX for any representable
SDK view, keyed lists, Yoga layout, a small UI library and real wrapper
ports beside their reference libraries. The gate closes with T52, which
certifies the preview's exact support matrix.

G2 (the Fabric and isolation spike, T44) passed on 2026-09-26, and the view
wave that followed shipped SwiftUI and Compose hosts. Views are still
behind the internal `LUCENT_VIEWS=fabric` switch. This gate turns them into
a preview. T48 is in review and T52 ready to start; TA25 and TA26 are
small fixes found on the way.

| Task          | Title                                                             | Needs    | Status               |
| ------------- | ----------------------------------------------------------------- | -------- | -------------------- |
| [T48](#t48)   | Derive general SDK-view JSX rules and diagnostics                 | —        | in review            |
| [T49](#t49)   | Add conditional and keyed-list reactive lowering                  | T48      | waiting              |
| [T50](#t50)   | Integrate Yoga with explicit layout-owner boundaries              | T48      | waiting (maintainer) |
| [T51](#t51)   | Implement the small Lucent UI library and examples                | T49, T50 | waiting (maintainer) |
| [T52](#t52)   | Complete useful wrapper ports and certify a preview               | —        | ready (maintainer)   |
| [TA25](#ta25) | Fix the bare app's FlatList crash from a second react-native copy | —        | in review            |
| [TA26](#ta26) | Lay out the slot after a native-only move on iOS                  | —        | ready                |

The Needs column lists only open dependencies.

<a id="t48"></a>

### T48: Derive general SDK-view JSX rules and diagnostics

**Goal:** Let JSX create and update any representable SDK view from its
native declarations, with no per-view entry in Lucent.

- **Status:** in review (2026-10-04): every item below passes on its
  branch.
- **Area:** Views and compiler.
- **Needs:** T13 (done), T36 (done), T43 (done), T44 (done).
- **Verify:** V1, V2, V4.
- **Where:** `packages/compiler/src/sdk/view-rules.ts` (the rules, under
  `sdk/` so the declaration cache follows them), `sdk/dts.ts` and
  `sdk/native-jsx-dts.ts` (typing), `emit/native-jsx.ts` (lowering),
  `ui/view-coverage.ts`; [views.md](docs/design/views.md#platform-views-as-jsx).

- [x] Derive view ancestry, constructors, writable props, type conversions
      and unambiguous platform event conventions from native declarations.
      Props are writable properties and (Android) one-value setters, the
      value's type picking the overload; events are Android's one-method
      `setOn<X>Listener` and iOS control events
      (`addAction:forControlEvents:`'s single-bit cases), the handler
      given the tag's class; children come from an insert-at-index method.
      On the real SDKs: UILabel 21 props, UIControl 16 events, TextView 91
      props, CompoundButton onCheckedChange.
- [x] Support an explicit `create` for constructor ambiguity, and raw
      listener or delegate code where semantic event sugar cannot be proved.
      `create={() => new X(…)}` makes any tag's view; multi-method
      listeners and generic setters are left out, explained, for setup code.
- [x] Emit concrete diagnostics for non-view elements, invalid children,
      unknown props, bad construction, stale reactive snapshots and affinity
      violations. TypeScript refuses non-view tags, unknown and read-only
      attributes and children of a class that inserts none; LUCENT3025
      reports native JSX not returned, spread attributes, a non-view child,
      no constructor, and a prop reading a setup-time copy of a prop; a
      left-out attribute gets its rule's reason; LUCENT3022 reaches
      attributes.
- [x] Golden-test randomized fixture view names, and attach rule
      explanations and declaration provenance to coverage and editor output.
      T28's unknown dial as JSX mounts on Mac Catalyst and compiles on
      Android under random names, its attributes' documented rules compared
      with the prefix normalized; each attribute's declaration carries its
      rule and artifact (the editor shows it), and `lucent sdk coverage
--views` lists them.

**Done when:** a new representable SDK view works without a new Lucent view,
prop, event or measuring entry.

**Notes:**

- Build on the JSX toolkit work rather than starting a second JSX path.
  Per-file JSX already resolves through `lucent:jsx` to a toolkit (the
  compiler's `jsxRuntimeOf`, the editor plugin's toolkit JSX), a component's
  body is the JSX it returns, found by type, SwiftUI attributes map to
  initializer labels or to modifiers in source order, and one-file
  components type their elements per platform. T48 extends this to platform
  views (`lucent:ios/UIKit`, Android `View` classes), with binding plans
  deciding what each attribute does. Today a platform-view component
  constructs its view in setup and returns it.
- Design reference: section 16.5 of [the
  design](docs/design/native-platform.md#165-derive-syntax-make-native-behavior-explicit).
  Its child adapters were replaced by derived children (decisions log,
  2026-10-04).
- Evidence: `test/view-rules.test.ts`, `test/ui/native-jsx-types.test.ts`,
  `test/ui/native-jsx-run.test.ts` (Catalyst), `test/ui/native-jsx-android.test.ts`,
  `test/ui/native-jsx-diagnostics.test.ts`, `test/unknown-library.test.ts`.
  Android views mount only on Android; their glue is compiled against
  jni.h.

<a id="t49"></a>

### T49: Add conditional and keyed-list reactive lowering

**Goal:** Make conditional and keyed-list UI update only what changed,
keeping each item's identity and lifetime.

- **Status:** open, waiting on open dependencies.
- **Area:** Views and compiler.
- **Needs:** T42 (done), [T48](#t48) (open).
- **Verify:** V1, V2, V3.
- **Where:** UI control-flow lowering, the keyed scope reconciler and the
  test backend.

- [ ] Implement conditional insertion and removal, and keyed item scopes
      with reactive item replacement for a preserved key.
- [ ] Define duplicate keys, array identity and mutation notification,
      nested scopes, cleanup, and stable component state across reorders.
- [ ] Verify that `[a,b,c] → [c,a,b]` causes no create or delete and one
      indexed move on the test backend, and that a title change affects only
      the retained item's binding.
- [ ] Add reorder, delete and reinsert stress tests with active tasks and
      listeners; measure before adding more elaborate move-minimizing
      algorithms.

**Done when:** UI control flow preserves identity and lifetimes and updates
only the affected operations under the specified mutation model.

**Notes:**

- Toolkit bodies already have the toolkits' own keyed lists (SwiftUI
  `ForEach`, Compose lazy items with a required key). T49 is Lucent's own
  reconciler for platform-view subtrees, plus the deterministic reference
  backend. Design reference: section 16.7.

<a id="t50"></a>

### T50: Integrate Yoga with explicit layout-owner boundaries

**Goal:** Lay out Lucent subtrees with React Native's Yoga, with exactly one
owner writing each frame.

- **Status:** open, waiting on open dependencies.
- **Area:** Views.
- **Needs:** T46 (done), T47 (done), [T48](#t48) (open).
- **Verify:** V1, V4, V5, V8.
- **Where:** UI layout integration and adapters, backend and device layout
  scenarios.
- **Needs the maintainer:** physical devices (V8).

- [ ] Use React Native's Yoga dependency, and avoid a second, conflicting
      Yoga ABI.
- [ ] Keep outer Fabric layout, the Lucent Yoga subtree and native-container
      child layout separate; a width prop must not silently switch the
      ownership mode.
- [ ] Implement layout and measure invalidation and frames through the
      approved adapters, including native content changes and constraints.
- [ ] Test nested native and Lucent containers, margins, padding and gaps,
      RTL and density, and confirm that only one owner writes each child's
      frame.

**Done when:** native and Yoga layouts compose with predictable ownership,
no competing frame writers and no perpetual measurement loop.

**Notes:**

- React children already lay out with Yoga inside a slot (the slot's shadow
  node, with the host's insets added to the Yoga border; T47b). Reuse that
  integration. Design reference: section 16.6.

<a id="t51"></a>

### T51: Implement the small Lucent UI library and examples

**Goal:** Provide a small set of standard primitives built only on Lucent's
public facilities, with documented and tested behavior.

- **Status:** open, waiting on open dependencies.
- **Area:** Views.
- **Needs:** T45 (done), [T49](#t49) (open), [T50](#t50) (open).
- **Verify:** V1, V2, V4, V5, V8.
- **Where:** `lucent:ui` primitive implementations and focused sample
  components.
- **Needs the maintainer:** physical devices (V8), and a scope decision (see
  the notes).

- [ ] Implement the agreed small set (View, Row, Column, Text, Image,
      Button, input, switch, scroll, pressable) in Lucent, over generic
      bindings and adapters.
- [ ] Keep public types identical across platforms; fix general capabilities
      instead of adding private compiler cases for individual primitives.
- [ ] Port Badge, a settings form, a keyed list and Stopwatch; use a
      monotonic clock or frame source rather than assuming each timer tick
      is 16 ms.
- [ ] Test keyboard and focus, dynamic text size, RTL, accessibility, and
      native frame progress while JavaScript is blocked, on physical
      devices.

**Done when:** the standard library is implemented through Lucent's public
facilities, and its supported behavior is documented and tested.

**Notes:**

- **Scope decision needed before this starts.** As written, T51 asks for
  cross-platform primitives with identical public types. The decisions of
  2026-09-26 (no cross-platform view DSL) and 2026-09-29 (platform-targeted
  imports, no common interface) rule that out for SwiftUI and Compose
  bodies. The maintainer should re-scope T51, for example to platform-view
  primitives only, or drop the identical-types requirement. Until then the
  task stays as written.
- Toolkit follow-ups the blog post names as next steps (from T57/T58 and the
  helper-view work): container helpers, lists inside helper views, and
  toolkit values (such as `Color`) as helper props. They belong here or in a
  task of their own once T51 is re-scoped.

<a id="t52"></a>

### T52: Complete useful wrapper ports and certify a preview

**Goal:** Ship a validated preview of native views: real wrapper ports
beside their reference libraries, with an exact support matrix.

- **Status:** open, ready to start.
- **Area:** Verification and views, with the platform hosts.
- **Needs:** T45 (done), T46 (done), T47 (done).
- **Verify:** V4, V5, V6, V8, V9.
- **Where:** Native wrapper port packages and examples, and the preview
  evidence matrix.
- **Needs the maintainer:** physical devices (V8).

- [ ] Implement stated subsets of a map, a web view, a camera preview, a
      video player, blur and native input, beside their reference libraries.
- [ ] Include controlled input selection and IME, focus, touch, keyboard and
      insets, VoiceOver and TalkBack, commands, event replacement and
      React-child composition.
- [ ] Run mount and unmount, background and foreground, Activity recreation
      and late-result tests; resource counts return to baseline.
- [ ] Prepare installation and docs with the exact supported subsets and
      open gaps; do not present a small example as full parity with the
      reference library.
- [ ] Carried over from T45: let a caller cancel a pending ref request
      (today a request settles only by its answer, unmount or reload).

**Done when:** G3 is a usable, validated wrapper preview. This task prepares
the preview artifacts; publishing them is a separate action.

**Notes:**

- Views are behind `LUCENT_VIEWS=fabric` today. The preview is where the
  maintainer decides what is switched on and documented for users. TA25 and
  TA26 should land first.

<a id="ta25"></a>

### TA25: Fix the bare app's FlatList crash from a second react-native copy

**Goal:** Make a FlatList work as a React child in the bare example app,
where it crashes today.

- **Status:** in review (2026-10-04): every item below passes on its
  branch.
- **Area:** Views, example apps.
- **Needs:** none.
- **Verify:** V5.
- **Where:** The bare example app's dependency resolution and its slots
  screen.

- [x] Reproduce: in the bare example app, `@react-native/virtualized-lists`
      resolves a second copy of `react-native` (the app's own
      `node_modules/react-native` and the workspace root's), the bundle
      holds two `ReactNativeViewConfigRegistry` copies, and FlatList fails
      with "View config getter callback for RCTScrollContentView must be a
      function". The second copy is installed under the hoisted
      virtualized-lists (its peer: the root holds the Expo app's release);
      `packages/lucent/test/bare-example-bundle.test.ts` bundles FlatList
      with the app's config and finds both registries.
- [x] Make the app resolve one `react-native`. The app's Metro config
      resolves `react-native` and its subpaths from the app, whatever
      module asks; each app keeps the release it pins.
- [x] Run the slots screen with a FlatList child on the iOS simulator and
      the Android emulator. The slots spike's lists are FlatLists again (a
      list of cards, rows in a card); `node scripts/views-spike.ts --entry
slots.js` passes its 16 checks on both, twice each, its list card
      and row 60 shown after scrolling.

**Done when:** a FlatList child in a Lucent slot runs in the bare app on
both platforms.

**Notes:**

- Found by T47 (React slots), which recorded it as a pre-existing problem of
  the example app's environment, not of Lucent; its spike lays its lists out
  by hand meanwhile.

<a id="ta26"></a>

### TA26: Lay out the slot after a native-only move on iOS

**Goal:** Move a slot's React children as soon as the slot moves on iOS,
even when no commit or command caused the move.

- **Status:** open, ready to start.
- **Area:** Views (iOS host).
- **Needs:** none.
- **Verify:** V1, V5.
- **Where:** The iOS host's slot layout (`HostSlot`) and the `ui::Content`
  callback.

- [ ] Mark the slot for layout from the `ui::Content` callback that T46
      added (it owns the sizing callback today; pass a second callback).
- [ ] Reset `HostSlot`'s bound when the slot moves.
- [ ] Test a slot moved by a timer or an animation on the iOS simulator: the
      children follow without waiting for the next host layout.

**Done when:** a native-only slot move on iOS repositions the children
without an unrelated layout pass.

**Notes:**

- Found by T47b, which documented it as a limitation. A similar wait applies
  inside a hosting controller between commits.

<a id="g4-production-candidate"></a>

## G4: Production candidate

Lucent is technically validated and ready for pilots: the semantic IR
migration and measured optimizations, the demanding capabilities (native
lists, gestures, media, background targets), the distribution matrix, the
no-catalog audit, stress tests, physical-device budgets, complete docs and a
green CI. The gate closes with T67.

T54, T60 and T28's binding follow-ups (TA30 to TA34) are ready now (CI has
been green on main since 2026-10-03). The rest follow G1 and G3 work.
Several tasks need physical devices, which only the maintainer can run.

| Task          | Title                                                           | Needs                   | Status               |
| ------------- | --------------------------------------------------------------- | ----------------------- | -------------------- |
| [T54](#t54)   | Implement measured compiler and runtime optimizations           | —                       | ready                |
| [T55](#t55)   | Implement native recycled and virtualized lists                 | T49, T50, T52           | waiting (maintainer) |
| [T56](#t56)   | Add native gestures and frame-driven animation facilities       | T51, T52                | waiting (maintainer) |
| [T59](#t59)   | Prove media pipelines, high-rate streams and callback executors | T52                     | waiting (maintainer) |
| [T60](#t60)   | Implement headless, background and additional native targets    | —                       | ready (maintainer)   |
| [T61](#t61)   | Finish the editor, doctor, SDK and debugging workflows          | T48                     | waiting              |
| [T62](#t62)   | Run the distribution and supported-version compatibility matrix | T52, T60, T61           | waiting              |
| [T63](#t63)   | Run the final no-catalog audit, including views and extensions  | T28, T48, T50           | waiting              |
| [T64](#t64)   | Run lifetime, concurrency and Fabric stress validation          | T49, T55, T59, T60      | waiting (maintainer) |
| [T65](#t65)   | Enforce physical-device performance budgets                     | T54, T55, T56, T59, T64 | waiting (maintainer) |
| [T66](#t66)   | Complete user documentation and migration examples              | T51, T52, T60, T61      | waiting              |
| [TA30](#ta30) | Bind Kotlin function types and callback properties              | —                       | ready                |
| [TA31](#ta31) | Finish the Kotlin shim shapes                                   | —                       | ready                |
| [TA32](#ta32) | Read Swift packages and the iOS target from the project         | —                       | ready                |
| [TA33](#ta33) | Bind the remaining Swift shapes                                 | —                       | ready                |
| [TA34](#ta34) | Turn a Java Throwable into a Lucent Error                       | —                       | ready                |
| [T67](#t67)   | Pass the integrated production-candidate gate                   | T62, T63, T64, T65, T66 | waiting (maintainer) |

The Needs column lists only open dependencies.

<a id="t54"></a>

### T54: Implement measured compiler and runtime optimizations

**Goal:** Make generated code faster where profiles show it matters, without
changing JavaScript semantics.

- **Status:** open, ready to start.
- **Area:** Compiler, with runtime and verification review.
- **Needs:** T10 (done), T30 (done), T32 (done), T53 (done).
- **Verify:** V1, V2, V3, V7.
- **Where:** Optimization passes and targeted runtime hot paths.

- [ ] Profile first; prioritize specialization and representation
      propagation, escape and allocation reduction, retain/release removal,
      devirtualization, conversion elimination and proven bounds and loop
      optimizations.
- [ ] For each pass, add a must-optimize fixture, a similar
      must-not-optimize fixture, verifier coverage, and a comparison of
      baseline and optimized observable results.
- [ ] Preserve JavaScript numbers, UTF-16, order, errors and identity, and
      keep floating-point contraction off; never use fast-math to win a
      benchmark.
- [ ] Report runtime gain, allocation and copy effects, native code size and
      build time; cap specialization growth and keep checks where the proof
      is insufficient.
- [ ] Carried over from the earlier TODO: find why `sieve` is about 21x
      faster than JavaScript on macOS but about 4.8x on the Linux CI runner
      (clang and libstdc++): `Array<boolean>` storage, the allocator,
      vectorization.
- [ ] Carried over from the earlier TODO: one allocation per string (units
      inline with the header, a non-atomic reference count for strings that
      never leave the Lucent thread); allocation dominates `wordCount` and
      `strings`, which are only 2–3x faster than JavaScript.

**Done when:** improvements are measured, semantics-preserving and within
the runtime, size and build budgets, rather than only producing shorter C++.

**Notes:**

- T10's host tooling is done; its physical-device baselines are deferred to
  the maintainer and belong to T65. Boundary budgets have thin margins:
  `structsOut1000` measured 2.56–2.71x against 2.75x on the development
  machine, and `structsIn1000` 1.63–1.67x on the CI runner, now against
  1.75x (decision of 2026-10-03). Design reference: section 13.4.

<a id="t55"></a>

### T55: Implement native recycled and virtualized lists

**Goal:** Render long lists natively with viewport-driven cells, recycling
and stable item identity.

- **Status:** open, waiting on open dependencies.
- **Area:** Views, with the platform hosts.
- **Needs:** [T49](#t49) (open), [T50](#t50) (open), [T52](#t52) (open).
- **Verify:** V1, V3, V4, V5, V8.
- **Where:** Native collection adapters, virtualization scopes and cache,
  and scenarios.
- **Needs the maintainer:** physical devices (V8).

- [ ] Add viewport-driven cell creation, explicit item and reuse identity,
      native recycling, measurement caching and scroll anchoring.
- [ ] Reset or cancel cell scopes by generation; keep only intentionally
      retained item state, and never reuse old listeners or tasks for a new
      item.
- [ ] Test large heterogeneous lists, insert, reorder and delete while
      scrolling, variable heights, accessibility focus, RTL and React
      composition boundaries.
- [ ] Measure mount count, memory, frame deadlines and retained resources;
      do not simulate virtualization with thousands of hidden native
      children.

**Done when:** collection behavior and sustained performance match the
declared parity scenarios on physical devices.

<a id="t56"></a>

### T56: Add native gestures and frame-driven animation facilities

**Goal:** Give views gestures and frame-driven animation that stay on the UI
thread and never wait for JavaScript.

- **Status:** open, waiting on open dependencies.
- **Area:** Views and runtime, with the platform hosts.
- **Needs:** T40 (done), [T51](#t51) (open), [T52](#t52) (open).
- **Verify:** V1, V3, V5, V8.
- **Where:** UI frame and gesture primitives, and interoperability
  scenarios.
- **Needs the maintainer:** physical devices (V8).

- [ ] Define monotonic frame timing, lifecycle pause and resume,
      cancellation, gesture ownership, event coalescing, and conflict and
      priority behavior.
- [ ] Keep visual updates on the UI thread and independent of JavaScript;
      preserve discrete gesture and interaction outcomes even when
      continuous events coalesce.
- [ ] Test interruption, unmount, background and foreground, nested
      scrolling, competing recognizers, reduced motion, and 60 and 120 Hz
      timing.
- [ ] Publish the supported interoperability with existing React Native
      gesture and animation libraries, based on tests rather than assumed
      compatibility.

**Done when:** the native interaction API has deterministic ownership and
cancellation, and physical-device frame evidence.

**Notes:**

- SwiftUI and Compose bodies already animate with the toolkits' own APIs and
  keep animating while JavaScript is blocked. T56 covers Lucent's own frame
  and gesture facilities for platform views, and interoperability with React
  Native's gesture and animation libraries.

<a id="t59"></a>

### T59: Prove media pipelines, high-rate streams and callback executors

**Goal:** Process camera, audio and image data natively at high rates, with
explicit backpressure and ownership.

- **Status:** open, waiting on open dependencies.
- **Area:** Runtime and verification, with the platform hosts.
- **Needs:** T30 (done), T32 (done), T33 (done), T40 (done), [T52](#t52)
  (open).
- **Verify:** V3, V4, V5, V7, V8.
- **Where:** Media and native pipeline fixtures, and narrow runtime stream
  and executor extensions.
- **Needs the maintainer:** physical devices (V8).

- [ ] Keep camera, audio and image buffers native across several processing
      steps; expose intentional handles or snapshots at the JavaScript
      boundary.
- [ ] Define bounded queues and distinct lossless, latest-value and
      frame-dropping policies; dispose dropped and cancelled buffers exactly
      once.
- [ ] Provide or validate restricted native callback executors for
      deadline-sensitive work, which forbid blocking, contended locks and
      unsafe JSI access.
- [ ] Measure throughput, p95 and p99 latency, copies, memory, energy and
      thermal behavior, and resource closure over a sustained
      physical-device workload.

**Done when:** the demanding data path has explicit backpressure and
ownership, and evidence that it meets its stated deadlines and memory
budget.

<a id="t60"></a>

### T60: Implement headless, background and additional native targets

**Goal:** Run Lucent code where no JavaScript runtime is live: background
tasks, services and app extensions.

- **Status:** open, ready to start.
- **Area:** Apple, Android and tooling, with one integration owner.
- **Needs:** T22 (done), T33 (done), T34 (done), T35 (done).
- **Verify:** V1, V3, V4, V5, V6, V8.
- **Where:** Target and build registration, headless lifetime roots and
  target fixtures.
- **Needs the maintainer:** physical devices (V8).

- [ ] Add native-owned execution roots with no implicit live JavaScript
      runtime.
- [ ] Generate service, extension and background registration, and
      per-target dependency, resource and entitlement configuration, through
      typed package fields.
- [ ] Reject JavaScript, presentation and application-only capabilities in
      contexts where the metadata or build settings forbid them.
- [ ] Build and run at least one platform extension target and one
      background or headless service or task fixture; verify shutdown and
      handling of a missing context.

**Done when:** additional targets build and run with explicit lifetimes,
restrictions and package provenance. A configuration-only scaffold does not
count.

**Notes:**

- `lucent.json` already declares entitlements, manifest components and
  targets as typed fields (T22). Design reference: section 17.1.

<a id="t61"></a>

### T61: Finish the editor, doctor, SDK and debugging workflows

**Goal:** Let a developer build and diagnose a module or view through one
coherent workflow.

- **Status:** open, waiting on open dependencies.
- **Area:** Tooling.
- **Needs:** T23 (done), T24 (done), T40 (done), T41 (done), [T48](#t48)
  (open).
- **Verify:** V1, V6, V9.
- **Where:** CLI and editor integration, JSON schemas, tree and ownership
  debugging output.

- [ ] Add navigation to a declaration's origin, availability and ownership
      diagnostics, quick fixes, SDK mapping explanations and used-symbol
      upgrade reports.
- [ ] Have `doctor` read the shared build and artifact identities, and
      explain dependency conflicts, cache misses, missing targets and stale
      installations.
- [ ] Show view trees, effect updates, source-mapped native failures, copy
      and queue traces and owned resources, without exposing implementation
      noise in ordinary application UI.
- [ ] Validate TTY, non-TTY and JSON output, `init`, new module and new
      view, transitive workspace edits, cold failures and recovery; measure
      the warm feedback targets.
- [ ] Carried over from T41: check that view loading runs the same
      stale-native identity check as modules (T41 left views to the view
      work), or add it.
- [ ] Carried over from the full SDK plan: run `lucent sdk coverage --all`
      in CI and show the top 20 skip reasons in the job summary (CI checks
      five iOS modules and `android.*` today).

**Done when:** a developer can build and diagnose a module or view through
one coherent workflow, and machine-readable consumers share its schema.

**Notes:**

- Design reference: sections 17.3–17.5.

<a id="t62"></a>

### T62: Run the distribution and supported-version compatibility matrix

**Goal:** Prove that installing and upgrading Lucent packages works on a
stated range of React Native and Expo versions.

- **Status:** open, waiting on open dependencies.
- **Area:** Verification and tooling.
- **Needs:** T17 (done), T27 (done), T33 (done), [T52](#t52) (open),
  [T60](#t60) (open), [T61](#t61) (open).
- **Verify:** V1, V4, V5, V6, V9.
- **Where:** The release matrix and CI fixtures, fresh-app package tests;
  lockfile changes go through the integrator.

- [ ] Define a stable React Native and Expo support window plus a prerelease
      lane, instead of relying only on the example apps' preview versions.
- [ ] Install tarballs into fresh bare and Expo projects; test two unrelated
      Lucent libraries with transitive dependencies and one native runtime.
- [ ] Cover clean, incremental and upgrade paths, monorepos, autolinking,
      R8, static and dynamic frameworks, native resources and
      app-store-style Release builds.
- [ ] Record the exact supported versions, configurations and failures; fix
      through the owning area and rerun only the affected matrix cells plus
      integration checks.
- [ ] Carried over from T08 and T11: build with `use_frameworks!` and
      dynamic linkage (static framework builds pass today).
- [ ] Carried over from T22: build a package's native inputs in a real Xcode
      and Gradle fixture (checked so far by unit tests and `ruby -c`).

**Done when:** package installation and supported upgrades work without
hidden workspace state or manual edits to generated projects.

**Notes:**

- The example apps use React Native 0.88 release candidates and an Expo 58
  preview; they alone cannot establish stable-version compatibility.

<a id="t63"></a>

### T63: Run the final no-catalog audit, including views and extensions

**Goal:** Confirm that no part of Lucent selects behavior by a framework or
library name.

- **Status:** open, waiting on open dependencies.
- **Area:** Verification, with bindings and views review.
- **Needs:** [T28](#t28) (open), [T48](#t48) (open), [T50](#t50) (open), T57
  (done), T58 (done).
- **Verify:** V1, V4, V5, V6.
- **Where:** Randomized end-to-end discovery suites and the architecture
  audit.

- [ ] Extend the unknown-library tests to views, props and events, child
      adapters, native factories, renamed modules and dependency upgrades.
- [ ] Verify that generic extraction works before any optional explicit
      package adapter, and that adapters describe behavior rather than
      unlock name allowlists.
- [ ] Audit compiler, runtime, schema and build logic for new framework-name
      switches or relocated central exception databases.
- [ ] Classify fixed language, ABI and platform anchors separately, with
      their rationale; require a regression test for every removed
      name-specific special case.

**Done when:** the dynamic-discovery requirement holds across the integrated
implementation, not only in the initial binding extractor.

**Notes:**

- T57 and T58 are done with a different meaning than planned: they became
  the host layers for SwiftUI and Compose bodies written in Lucent, not
  factory packages. For this audit, "native factories" means
  `lucent:swiftui` and `lucent:compose`, which are generated from the
  installed SDKs' interfaces; check that nothing in them is a hand-written
  list.
- The starting inventory (T01) found one central catalog, named awaitables,
  which T25 removed.

<a id="t64"></a>

### T64: Run lifetime, concurrency and Fabric stress validation

**Goal:** Find and fix every reproducible deadlock, use-after-free,
stale-owner access and resource leak under stress.

- **Status:** open, waiting on open dependencies.
- **Area:** Verification and runtime.
- **Needs:** T21 (done), T30 (done), T32 (done), T45 (done), [T49](#t49)
  (open), [T55](#t55) (open), [T59](#t59) (open), [T60](#t60) (open).
- **Verify:** V3, V5, V8.
- **Where:** Stress harnesses and reports; production fixes stay with their
  owning area.
- **Needs the maintainer:** physical devices (V8).

- [ ] Stress registration, completion and cancellation races, synchronous
      reentrancy, multiple runtimes, reload, destruction and arbitrary
      queued late outcomes.
- [ ] Run 1,000 mount/dispose and subscribe/cancel cycles after warmup;
      check live owned counts, native callbacks, pending work and
      retained-memory trends.
- [ ] Recycle hosts and cells while commands, events, measurements and media
      results are pending; verify generation rejection and the release of
      the losers' resources.
- [ ] Run the applicable sanitizers plus real platform background,
      recreation, camera and audio scenarios; minimize every failure into a
      regression fixture.
- [ ] Carried over from T30: check whether tearing down one of several JSI
      runtimes cancels the other runtimes' compute tasks (one process-wide
      module scope follows the last `Host::create`; suspected, not
      verified).

**Done when:** no reproducible deadlock, use-after-free, stale-owner access,
cross-thread JSI access or unbounded owned-resource growth remains.

<a id="t65"></a>

### T65: Enforce physical-device performance budgets

**Goal:** Back every claimed performance target with reproducible
physical-device evidence.

- **Status:** open, waiting on open dependencies.
- **Area:** Verification.
- **Needs:** T10 (done), T40 (done), [T54](#t54) (open), [T55](#t55) (open),
  [T56](#t56) (open), T57 (done), T58 (done), [T59](#t59) (open),
  [T64](#t64) (open).
- **Verify:** V7, V8.
- **Where:** Benchmark manifests and results, regression reports.
- **Needs the maintainer:** physical devices (V8), including a midrange
  Android phone.

- [ ] Compare equivalent operations on current pinned Lucent, Nitro,
      TurboModules and Expo, native and Hermes implementations as
      applicable, with checked outputs.
- [ ] Report primitive calls, bulk data and owned buffers, compute, UI
      frames, startup, code size, build feedback, memory and sustained
      thermal behavior.
- [ ] Use warmup and repeated samples, enough samples for the tail
      latencies, controlled order and thermal conditions, and repeat noisy
      threshold crossings.
- [ ] Enforce the recorded budgets; an unresolved miss stays a failed
      criterion with trace evidence and an owning task, never a silently
      weakened threshold.
- [ ] Carried over from T10 and T44: record the physical-device frame and
      lifecycle baseline and the Fabric spike's frame results.
- [ ] Carried over from T44 and T40: capture Android lock traces (Perfetto)
      to match the iOS trace with no main-thread lock waits, and export the
      correlated traces into Instruments and Perfetto from a device.

**Done when:** every claimed performance target has reproducible
physical-device evidence, with its workload and limitations stated.

**Notes:**

- The budgets are listed under [Validation](#performance-budgets).

<a id="t66"></a>

### T66: Complete user documentation and migration examples

**Goal:** Make the public docs enough for independent use, and make them
match shipped behavior.

- **Status:** open, waiting on open dependencies.
- **Area:** Tooling and verification, with each area's authors.
- **Needs:** T25 (done), T27 (done), [T51](#t51) (open), [T52](#t52) (open),
  T57 (done), T58 (done), [T60](#t60) (open), [T61](#t61) (open).
- **Verify:** V1, V9.
- **Where:** Public guides, reference and examples, coordinated with ongoing
  docs.

- [ ] Finish module and view tutorials, setup-once reactivity, ownership and
      threading, buffers, SDK discovery, adapters, native configuration and
      troubleshooting.
- [ ] Publish capability and support tables generated from actual evidence;
      remove stale claims, and distinguish TypeScript-only support from
      explicit native extensions.
- [ ] Add Nitro and Expo migration examples that keep a stated React-facing
      API, including the removed awaitable sugar and the native rebuild and
      update requirements.
- [ ] Compile every current-capability example, synchronize screenshots,
      traces and diagnostics, and label the remaining proposal examples as
      proposals.
- [ ] Carried over from the full SDK plan: guides for Swift-only APIs,
      Kotlin APIs, awaiting a Play services `Task` with `fromCallback`, and
      `using`; the type-mapping reference extended; generated coverage
      tables.
- [ ] Carried over from the docs plan: runnable samples in CI (run in
      Hermes, output compared with the page), a weekly external link check,
      and a run of the tutorial on the iOS simulator and the Android
      emulator.

**Done when:** the docs support independent use and match shipped behavior.
This final sweep does not excuse delaying docs for earlier completed tasks.

<a id="ta30"></a>

### TA30: Bind Kotlin function types and callback properties

**Goal:** Let Lucent functions be Kotlin function types and fill
callback properties, which T28's unknown Android view could not.

- **Status:** open, ready to start.
- **Area:** Bindings, Android host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** Kotlin metadata to schema types, Android declarations and
  JNI glue (`NativeProxy` for `kotlin.jvm.functions`), the view rules.

- [ ] Bind a Kotlin function type (`(Double) -> Unit`, nullable or not) as
      a TypeScript function type both ways: a Lucent function passed or
      assigned becomes a `FunctionN` proxy, and a Kotlin one returned is
      callable.
- [ ] Let a property of a single-method interface type take a Lucent
      function, as a method parameter of that type does.
- [ ] Let a view set such a property with a function (its call runs on the
      main thread), instead of refusing every way to set it (LUCENT3021).
- [ ] Extend T28's unknown library: its Android dial takes a Kotlin
      function-typed property, run on the desktop JNI host where it does
      not need a view.

**Done when:** the idiomatic Kotlin callback shapes bind by rule, in
module code and in views.

**Notes:**

- Found by T28: `var onTurn: ((Double) -> Unit)?` is typed as the class
  `Function1<number, Unit>`; a `fun interface` property rejects a function
  (TS2322), and a view refuses an object implementing it.

<a id="ta31"></a>

### TA31: Finish the Kotlin shim shapes

**Goal:** Call the Kotlin members T26's shims refuse.

- **Status:** open, ready to start.
- **Area:** Bindings, Android host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** `packages/compiler/src/emit/kotlin.ts`, the shim plans.

- [ ] Generic members (functions and properties of a type parameter).
- [ ] Lucent functions passed as `suspend` functions.
- [ ] Assigning value classes, and implementing members that take them.
- [ ] Defaults left out for generic members.

**Done when:** each shape is called through a shim and checked by the
Kotlin shim tests, or refused with a diagnostic naming the member.

<a id="ta32"></a>

### TA32: Read Swift packages and the iOS target from the project

**Goal:** Bind Swift packages an app adds, against the iOS version the app
targets.

- **Status:** open, ready to start.
- **Area:** Bindings, Apple host, build.
- **Needs:** none.
- **Verify:** V1, V4, V5.
- **Where:** `packages/bindgen/src/provider.ts` (iOS artifacts), the Xcode
  project reader.

- [ ] Discover Swift Package Manager modules the app's Xcode project
      resolves, as pods are, keyed by their resolved versions.
- [ ] Extract against the deployment target the project sets, not a fixed
      one.

**Done when:** an app's Swift package binds by rule, and an API newer than
the app's target needs an availability check.

**Notes:** `use_frameworks!` with dynamic linkage is [T62](#t62)'s.

<a id="ta33"></a>

### TA33: Bind the remaining Swift shapes

**Goal:** Bind or precisely refuse the Swift shapes still left out.

- **Status:** open, ready to start.
- **Area:** Bindings, Apple host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** `packages/bindgen/src/swift.ts`, `ios.ts`, the Swift shims.

- [ ] Tuples, which the extractor skips (now explained when called).
- [ ] Functions returned by or passed to Swift (LUCENT2002, "fn values
      cannot cross to Swift yet").
- [ ] Factory initializers Swift imports as `init`, which the extractor
      drops (recheck first: recorded 2026-09-23).
- [ ] Members Swift imports onto CoreFoundation-style handles
      (`cgImage.width`; recheck first).
- [ ] A subclass's initializers inherited from a class whose module is only
      named: today `new Dial(frame)` fails with TS2674 (UIView's
      constructor is protected) until UIKit is imported. Type them, or say
      to import the superclass's module.

**Done when:** each shape binds by rule, or its diagnostic names the member
and what to do.

<a id="ta34"></a>

### TA34: Turn a Java Throwable into a Lucent Error

**Goal:** Let adapters reject with the `Error` a thrown Java exception
becomes, its `code` kept.

- **Status:** open, ready to start.
- **Area:** Runtime, Android host.
- **Needs:** none.
- **Verify:** V1, V3.
- **Where:** `lucent:android`, `packages/runtime/cpp/lucent/platform/android.cpp`
  (`errorOf`).

- [ ] Add a `lucent:android` function taking a `Throwable` and returning
      the `Error` Lucent makes of a thrown one (`name`, `message`, `code`
      as the class name).
- [ ] Use it in an adapter test where a callback API reports failure with a
      `Throwable`.

**Done when:** an adapter's rejection has the same `code` as a thrown
exception's.

**Notes:** From T25, which removed the named awaitable dispatch.

<a id="t67"></a>

### T67: Pass the integrated production-candidate gate

**Goal:** Validate the integrated result and prepare a release candidate
that is ready for pilots.

- **Status:** open, waiting on open dependencies.
- **Area:** Integration and verification.
- **Needs:** [T62](#t62) (open), [T63](#t63) (open), [T64](#t64) (open),
  [T65](#t65) (open), [T66](#t66) (open).
- **Verify:** V1–V9 as applicable.
- **Where:** The integrated acceptance report and release-candidate
  artifacts.
- **Needs the maintainer:** physical devices (V8) and the deferred device
  checks.

- [ ] Merge reviewed work and rerun the full checks at the recorded
      candidate commit: compiler, runtime and e2e, platform glue, both app
      checks, smoke install, budgets, docs and the required device matrix.
- [ ] Verify changesets and version compatibility, source-map and crash
      evidence, installed artifacts, one-runtime behavior and upgrade and
      deprecation guidance.
- [ ] Reconcile every capability row, acceptance checkbox and status entry
      in this file; distinguish unavailable external validation from passing
      internal tests.
- [ ] Prepare a release-candidate report with exact artifacts, reproducible
      logs, remaining limitations and release and rollback steps.

**Done when:** G4 is technically validated and ready for pilots. Preparing
release artifacts does not itself publish packages, merge release pull
requests or contact external users.

**Notes:**

- The deferred device checks (see [Known limitations](#deferred-checks))
  must have run by this gate.

<a id="g5-production-recommendation"></a>

## G5: Production recommendation

An evidence-backed production recommendation, based on real external use:
pilot packages for independent library authors and real apps, their actual
results and fixes, and a final capability and readiness assessment. The gate
closes with T70.

These tasks follow G4. They need people outside the project, so they need
the maintainer: an agent running its own exercises does not count as
independent use.

| Task        | Title                                                       | Needs    | Status               |
| ----------- | ----------------------------------------------------------- | -------- | -------------------- |
| [T68](#t68) | Prepare independent author and app pilot packages           | T67      | waiting (maintainer) |
| [T69](#t69) | Collect real pilot evidence and close the resulting defects | T68      | waiting (maintainer) |
| [T70](#t70) | Produce the final capability and readiness assessment       | T67, T69 | waiting              |

The Needs column lists only open dependencies.

<a id="t68"></a>

### T68: Prepare independent author and app pilot packages

**Goal:** Give independent library authors and app teams material they can
complete without a maintainer's help.

- **Status:** open, waiting on open dependencies.
- **Area:** Tooling and verification.
- **Needs:** [T67](#t67) (open).
- **Verify:** V6, V9.
- **Where:** Self-contained pilot instructions, packaged fixtures and
  reporting templates.
- **Needs the maintainer:** pilot access (participants come through the
  maintainer).

- [ ] Prepare module and SDK integration, native view, and compute and
      buffer exercises that can be completed without undocumented maintainer
      guidance.
- [ ] Define the success measures: time to a first working result, confusing
      failures, manual edits to generated files, debugging success and
      package installation.
- [ ] Prepare migration and production-soak checklists for at least two real
      apps and the target of three independent library authors.
- [ ] Hand the materials over through an authorized channel; participants
      come through access the maintainer provides or explicitly requests.

**Done when:** independent participants can run the pilot package. An agent
running its own exercises does not satisfy T69's independence.

<a id="t69"></a>

### T69: Collect real pilot evidence and close the resulting defects

**Goal:** Gather real independent-use and real-app evidence, and fix what it
finds.

- **Status:** open, waiting on open dependencies.
- **Area:** Verification and integration.
- **Needs:** [T68](#t68) (open).
- **Verify:** V8, V9, plus each defect's own profiles.
- **Where:** Pilot findings and evidence; fixes go back to the owning areas.
- **Needs the maintainer:** pilot access and physical devices.

- [ ] Collect actual results from independent library authors and real apps,
      with versions, scenarios, evidence and the amount of help they needed.
- [ ] Run or collect sustained, production-like lifecycle, memory and crash
      evidence for the accepted module, view and compute workloads.
- [ ] Turn each failure into a bounded regression task, integrate the fix,
      and rerun the affected acceptance and candidate checks.
- [ ] Record unmet participant, hardware or access requirements as external
      blockers; keep fixing independent issues without fabricating
      testimonials or completion.
- [ ] Carried over from the docs plan: the acceptance test with two people
      from outside the project, on a fresh Expo app and a fresh bare app.

**Done when:** the independent-use and real-app targets are met with actual
evidence, or the maintainer explicitly revises those targets.

<a id="t70"></a>

### T70: Produce the final capability and readiness assessment

**Goal:** Turn the evidence into a production recommendation and a
maintenance backlog.

- **Status:** open, waiting on open dependencies.
- **Area:** Integration.
- **Needs:** [T67](#t67) (open), [T69](#t69) (open).
- **Verify:** V0, plus the candidate checks the pilot fixes affect.
- **Where:** The final completion report and the reconciliation of this
  file.

- [ ] Confirm every mandatory task and gate is done or covered by an
      explicitly accepted scope change, with no unresolved safety, semantic
      or performance blocker.
- [ ] Revalidate the final post-pilot integration commit and the artifact
      identities.
- [ ] Publish the final matrix of capabilities, TypeScript-only and adapter
      paths, supported platforms and versions, benchmark evidence and known
      limitations.
- [ ] Prepare the concrete release decision and the next maintenance
      backlog; external publication follows the maintainer's separate
      instructions.

**Done when:** G5 has an evidence-backed production recommendation. A
passing compiler suite alone does not support a claim of universal platform
support or of being the default choice.

## Done

Finished work, grouped by area, with what it gave users. Task IDs refer to
the native-platform plan (2026-09-24 onward); the earlier plans come
last. Unless a line says otherwise, the evidence is host tests plus the
iOS simulator and the Android emulator; physical-device checks are
[deferred](#deferred-checks).

### Planning and verification

- **T00** Reconciled the code, in-flight work and the earlier status
  documents; recorded the baseline, the toolchains and the checks that
  could not run.
- **T01** Froze the first contracts (C-BIND, C-IR, C-EXEC) and adopted the
  no-catalog rule, with an inventory of name-based special cases. Closed
  G0 with T00.
- **T02** Created the verification manifest: exact versions, a capability
  matrix (basic modules to distribution) and the performance budgets.
- **T10** Extended benchmarking: raw samples, latency apart from
  throughput, structured results, copy, allocation and size counters.
  Physical-device baselines are deferred.
- **TA1, TA2** Rewrote both example apps (bare and Expo) from scratch, with
  focused real-world examples, a design system, one component per file and
  automation hooks; fixed the compiler and Android-build bugs the rewrite
  found.

### Bindings and SDKs

- **T03** Gave the binding schema native symbol identities, provenance,
  facts with evidence, and binding plans.
- **T04, T12** Type-checked the generated declarations without
  `skipLibCheck` and fixed every error (Android audit 81 → 0, iOS 0).
- **T07** Compared Kotlin metadata readers; the TypeScript decoder won (see
  the decisions log).
- **T08** Finished Swift shim acceptance: CryptoKit, StoreKit 2 and
  AVFoundation on the simulator; static framework builds pass. StoreKit
  `purchase()` is deferred; dynamic frameworks moved to [T62](#t62).
- **T11** Discovered artifacts from the resolved build (pods, Gradle
  variants) and keyed caches by their real inputs, with atomic publishing;
  `use_frameworks!` with static linkage works.
- **T13** Routed every SDK use through a binding plan; covered the
  remaining ABI shapes (bounded buffers, out and inout pointers,
  selectors, protocol compositions, option sets accepting 0) by rule or by
  a diagnostic.
- **T15, T16** Added a Kotlin syntax tree and printer to `packages/codegen`
  (compiled with `kotlinc -Werror`), and normalized Kotlin metadata into
  the schema.
- **T17** Added Swift protocol requirements with associated types and
  `Self`, iOS availability checks (`LUCENT3007`), Lucent subclasses of
  Objective-C classes, and cancellable Swift `async` calls.
- **T24** Added coverage stages, `lucent sdk lock` with `--frozen`, and
  `lucent sdk diff` of the symbols a project uses.
- **T25** Removed the named awaitable dispatch: `await` on a native object
  is `LUCENT1010`, and adapters use `fromCallback`.
- **T26** Generated Kotlin shims: `suspend` as promises with coroutine
  cancellation, defaults left out natively, value and sealed classes,
  extensions and top-level functions.
- **T27, TA15** Copied Kotlin collections as snapshots, collected `Flow`s
  with Lucent functions, and ported DataStore Preferences and Credential
  Manager.
- **T33** Added typed native extensions: a C header and a `lucent.json`
  contract, checked with clang, imported from `lucent:ext/<name>`.
- **TB1–TB4, TA11, TA19, TA21, TA24** Added `bigint` to the runtime and the
  language, made every native 64-bit integer a `bigint` (Kotlin shims
  included), converted and compared `bigint | number` as JavaScript does,
  and migrated docs, samples and apps.
- **Fixes** A `@WorkerThread` member of a `@UiThread` class; the Expo
  plugin's unquoted key.

### Compiler and language

- **T05, T18** Introduced the semantic IR with a verifier, and lowered
  ordered expressions and structured control flow through it.
- **T19** Added whole-program effects, captures and owners (`ProgramFacts`).
- **T53** Finished the semantic IR migration (2026-10-02): every
  function, method, accessor, constructor, module `init()`, compute task
  variant and component setup lowers through the IR, with native and
  builtin operations as plans the emitter's leaf code writes once; a
  setup's mount is an ambient its closures enter, a toolkit body's slots
  thunks. The legacy emitter's statement lowering, its fallbacks and the
  `LUCENT_LOWERING` selector are removed, and what the IR cannot lower
  is a LUCENT diagnostic. Verified with e2e (53 of 53), the full compiler
  suite and its views and platform compile tests, `bench --check` at the
  legacy emitter's speeds, and the bare app's `app-check`.
- **T30** Added `compute` with checked tasks (`LUCENT3011`, `LUCENT3012`).
- **T32** Added `NativeBuffer`, scoped spans and moves (`LUCENT3030`,
  `LUCENT3031`), with zero-copy handoff to tasks.
- **TA4, TA5** Kept the effects of converted absent values, compiled
  `void | undefined` and never-returning calls anywhere, and made async
  bodies that only throw reject.
- **TA7** Fixed IR `switch` returns, shielded C++ macro names, and
  supported `Map` and `Set` spread and conditional object literals.
- **TA9, TA12, TA16, TA18** Made `===` work on arrays, maps, sets and byte
  arrays and between different C++ types; refused loose `==` that converts
  (`LUCENT1002`) and function comparisons.
- **TA14** Printed numbers with JavaScript's exact shortest digits
  (Dragonbox), and fixed `toFixed` and radix `toString` edge cases.
- **TA17, TA22, TA23** Made the main-thread and compute checks precise
  about native calls that call back into Lucent.
- **TA27** Printed Swift by precedence and associativity.

### Runtime and execution

- **T06** Added lifetime scopes and one-shot operations.
- **T14** Added `fromCallback` and `subscribe`.
- **T20** Added execution contexts and owner-aware promises.
- **T21** Added resources (open, closing, closed), one `Host` per runtime
  and per-runtime teardown.
- **T29, T31** Added the bounded compute pool with copy transport, and
  native buffer control blocks.
- **TA3** Made the Lucent lock fair, so JavaScript calls get in while a
  Lucent loop yields.
- **TA6, TA8** Fixed a test-only sanitizer report, and a race between a
  compute task and a JavaScript reload on module constants.

### App integration

- **T34** iOS scenes, presentation context, lifecycle and URL events,
  composed with other installed modules.
- **T35** Android Activity, activity results and permission requests that
  survive Activity recreation and drop late answers; a picker flow through
  recreation and process death on the emulator. T12 fixed the binding gaps
  that blocked `BiometricPrompt`.

### Build and tooling

- **T09** Recorded every build step in a build graph.
- **T22** Typed package configuration with provenance and deterministic
  merging: native sources, resources, Swift packages, frameworks,
  libraries, entitlements, manifest components and targets.
- **T23** Classified changes into required actions and watched linked
  packages.
- **T40** Correlated runtime, build and view traces.
- **T41** Detected stale native programs (`LUCENT_NATIVE_MISMATCH`).
- **TA10, TA13** Ran app checks against the host build's identity, and
  made `expo prebuild` work from a fresh checkout.
- **TA28, TA29** Made CLI tests unable to hang; made the suites pass on
  Linux and macOS CI runners, and fixed the product bugs that surfaced
  (Android builds without Xcode, bounded SDK prefetch, a GCC `BigInt`
  evaluation-order bug, a scheduler owner leak, a clang 18 miscompile, Expo
  apps before prebuild).
- **CI green on main** (2026-10-03): every CI job passes on main, first at
  `23cc5a1a` (#65) and again at `fe9758de` (#64). The website's generated
  samples were regenerated after the IR; the iOS job installs pods before
  and after `lucent build` (LUCENT3004 now names `pod install` when no pods
  were read); `structsIn1000`'s budget is 1.75x, and CI reports the
  CPU-bound bench ratios rather than enforcing them (both by recorded
  decisions). With #63 and #64, a run takes about ten minutes instead of
  two hour-long jobs.

### Views

- **T36, T37** Recognized components (`LUCENT3020`–`LUCENT3023`) and
  generated their Fabric descriptors, props, events and JavaScript proxies.
- **T38, T39** Built the iOS and Android Fabric hosts.
- **T42, T43, TA20** Added the UI-owned signal and effect graph (420
  differential scenarios against a JavaScript reference) and one view
  design driving both hosts.
- **T44, T44-sizing** Passed the joint Fabric, sizing and isolation spike
  in both apps on both platforms, Release and Debug, closing G2
  (2026-09-26).
- **T45** Completed events (discrete, `Continuous`, `Coalesced`), requests
  answered once per mount, and ref errors.
- **T46** Completed constrained and intrinsic sizing, including content
  revisions and Dynamic Type.
- **T47, T47b** Added React children in a slot, laid out inside the slot's
  real rectangle.
- **TD1–TD7, TDU** Wrote SwiftUI and Compose bodies in Lucent: spikes, a
  unified design, `lucent:swiftui` generated from SwiftUI's interface,
  `lucent:compose` generated from Compose and Material 3 metadata, lists,
  bindings and actions, and the SwiftUI controls ordinary UIs need.
- **T57** SwiftUI host layer: containment before appearance, size reports
  from the parent, RTL, one controller per mount, no leaks. Done with a
  different meaning than planned: it hosts generated SwiftUI content
  instead of a factory package.
- **T58** Compose host layer: one composition per mount with view-tree
  owners, saved state and disposal; Expo's first build works. Same change
  of meaning as T57.
- **TJ-N, TJ-S, TJ-C, TJ-H, TJ-1** Removed `native()`, wrote SwiftUI and
  Compose as JSX with no wrappers, added helper view functions, and put
  both platforms' bodies in one file.

### Website and release

- **Generated C++ platform tabs (2026-10-03)** Show iOS and Android output
  in one tabbed block inside each “See the C++” disclosure. Single-file
  output keeps its existing code block.

- **Mobile homepage navigation (2026-10-03)** Keep the logo, search, and menu
  control on one row; reveal navigation links in a touch-friendly dropdown.

- **Voltage homepage and docs (2026-10-03)** Implemented the reviewed homepage
  with native logic and experimental views, a current-blog announcement,
  animated platform diagram, and React Native/Expo compatibility. Docs use
  wrapping navigation labels, a keyboard-scrollable sidebar that stops above
  the footer, attached code tabs, compact filename headers, a shared searchable
  docs dialog and responsive typography. The homepage is a dedicated Astro page; docs retain Starlight.

- **Release** `@lucent-lang/lucent` 0.1.0 on npm (2026-09-30).
- **Blog** A blog with its first post (native views), link previews and an
  RSS feed. The website moved to Astro Starlight on 2026-10-01.

### Earlier plans

These plans came before the native-platform plan. Their open items are
now tasks above, or [known limitations](#known-limitations-and-deferred-checks).

- **The C++ rewrite (M0, M1).** The runtime (strings, numbers, arrays,
  maps, errors, bytes, promises, scheduler, JSON, `Date`, `RegExp`, full
  Unicode case mapping), the compiler (structs by shape, classes and
  inheritance, interfaces, unions and narrowing, closures, try/catch/finally,
  async, generics, generators, integer inference, `#line` source
  locations), one C++ TurboModule, the Metro and Expo integrations, the
  editor plugin, a differential e2e suite against Hermes, app checks and CI.
- **Improvement plan (2026-09-23).** Platform callbacks (iOS blocks,
  completion handlers as promises, Lucent classes implementing protocols,
  Android `NativeProxy`, subclasses of abstract SDK classes), build and
  test reliability, publishing Lucent libraries (`lucent.json`,
  transitive discovery, namespacing, version ranges, merged native
  dependencies), bindings from platform metadata (structured schema
  types, coverage reports, other modules' C types, bridged value types,
  opaque handles, sets), single-file platform branches, and the
  expo-local-authentication, expo-location and netinfo ports.
- **One package and the CLI (2026-09-24).** `@lucent-lang/lucent` as the
  only published package; `build`, `check`, `dev`, `doctor`, `init`,
  `explain`, `new module`, `clean`, `sdk search|show|prefetch|coverage` and
  `bench`, with `--json` schemas and generated reference docs.
- **Docs plan (2026-09-24).** Writing rules checked by Vale, the Start
  pages, How Lucent works, Thinking in Lucent, the eight-step tutorial,
  generated reference pages, 22 guides, examples, the FAQ and the roadmap
  page.
- **Full SDK plan (2026-09-24).** Docs matched to code; Android generic
  classes, `using` with `Closeable`, `@IntDef` groups, `@MainThread`
  checks, Objective-C generics, blocks taking blocks and out-parameters;
  the codegen package; Swift shims for Swift-only APIs. Its Kotlin part
  became T07, T15, T16, T26 and T27; its long tail became T13 and T24.

Last recorded coverage of unrepresentable members (2026-09-25, after the
Swift shims; `lucent sdk coverage` in the bare example app):

| Module            | Unrepresentable        |
| ----------------- | ---------------------- |
| UIKit             | 941 of 8,117 (11.6%)   |
| Foundation        | 3,090 of 9,520 (32.5%) |
| AVFoundation      | 276 of 4,089 (6.7%)    |
| StoreKit          | 186 of 882 (21.1%)     |
| CryptoKit         | 143 of 588 (24.3%)     |
| `android.*`       | 40 of 79,187 (0.1%)    |
| `androidx.core.*` | 10 of 4,544 (0.2%)     |
| `gms.location`    | 0 of 526 (0.0%)        |

The toolkits, when generated (TD3 to TD7): SwiftUI 3,556 representable
members; Compose 6,455 of 7,555 (85.4%).

## Contracts

The contracts are the shared interfaces between the binding schema, the
compiler, the runtime, the build and the views. They are kept in full, with
every revision, in [docs/design/contracts.md](docs/design/contracts.md):
including them here would double this file's length, and they change by
revision, not by task.

| Contract | Covers                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| C-BIND   | Binding schema identity, provenance, native facts, binding and conversion plans                               |
| C-IR     | The semantic IR, its verifier, effect summaries and program facts                                             |
| C-EXEC   | Runtime identities, scopes, one-shot operations, execution contexts, transport, compute, callback composition |
| C-BIGINT | The runtime `BigInt`                                                                                          |
| C-BUFFER | `NativeBuffer`, borrows, transfer and the JavaScript handle                                                   |
| C-VIEW   | Component identity, prop transactions, events, commands, mounts, hosts, children and toolkit bodies           |
| C-BUILD  | The build graph, required actions, build identities and SDK locks                                             |
| C-TRACE  | Correlated trace events                                                                                       |
| C-EXT    | Typed native extensions                                                                                       |

## Validation

Every task names the profiles it must pass. Build the CLI with `pnpm build`
after changing `packages/` (it runs `dist/`). Check a test runner's filter
syntax before relying on it: a filter that runs zero tests proves nothing.

| Profile | Checks                                                                                                                                         | How to run                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| V0      | Formatting, links and schemas; evidence reconciled                                                                                             | `pnpm check`, `git diff --check`                                                                                                |
| V1      | Unit tests and typecheck, build, the integrated check and tests                                                                                | `pnpm build`, `pnpm check`, `pnpm test:all`                                                                                     |
| V2      | V1 plus native-versus-JavaScript e2e cases, codegen corpus review, semantics docs                                                              | `HERMES_DIR=~/hermes node packages/compiler/test/e2e/run.ts [case…]`, then `node scripts/sync-examples.ts` after changing cases |
| V3      | Runtime tests and sanitizers, scheduling and lifetime tests                                                                                    | `packages/runtime/test/run.sh`, `SANITIZE=1 CXX=g++ packages/runtime/test/run.sh`, `SANITIZE=thread` where it applies           |
| V4      | Fixture SDKs extracted, declarations type-checked without `skipLibCheck`, platform glue compiled with warnings as errors, availability and R8  | The bindgen, SDK-declaration and glue-compile test suites (part of `pnpm test` where the SDKs exist)                            |
| V5      | Both example apps against their generated C++; Release screens on the iOS simulator and the Android emulator                                   | `HERMES_DIR=~/hermes node scripts/app-check.ts apps/bare-example` and `apps/expo-example`; the apps' Lab screens                |
| V6      | The packed package in fresh bare and Expo apps; clean and incremental builds, autolinking, lockfiles                                           | `node scripts/smoke-install.ts`                                                                                                 |
| V7      | Performance budgets, output equivalence, native and framework comparisons, allocation, copy and size reports                                   | `HERMES_DIR=~/hermes node scripts/bench.ts --check`                                                                             |
| V8      | Named physical iPhone and Android devices, including a midrange Android phone; frame, latency, memory and lifecycle traces against the budgets | Needs the maintainer                                                                                                            |
| V9      | Public docs, examples and diagnostics; website checks; a changeset or the `no-changeset` label                                                 | `node scripts/website.ts --check`, `pnpm changeset`                                                                             |

Evidence levels are kept apart: **code** (written), **host** (host tests),
**sim** (iOS simulator or Android emulator), **device** (named physical
device) and **external** (independent users). A higher level never
follows from a lower one, and a check that could not run is reported as
blocked.

An integration gate runs, in one checkout: `sync-examples`, `pnpm build`,
`pnpm check`, `pnpm test:all`, the e2e suite with both lowerings, the runtime
tests plain and under ASan and TSan, the JSI host checks, SDK coverage,
the website check, the smoke install and the bench budgets. On the main
checkout it then reviews the codegen corpus and runs both app checks.

Last recorded runs:

- **Final view-wave gate (2026-09-30):** all green: 146 test files,
  1,502 tests; e2e with both lowerings; runtime plain, ASan and TSan; JSI;
  coverage; website and its typecheck; smoke install; bench (structsOut
  2.61x against 2.75x). Linux containers (Node 24, Ubuntu 24.04 with clang
  18 and g++ 13) ran the unit, runtime, JSI and e2e suites and both app
  checks green.
- **Devices (2026-09-30):** iOS simulator toggle and list screens; Android
  emulator (with recycling) toggle, list and slots screens: 0 app errors,
  0 fatal, 0 failed checks. The apps' full Lab screens last ran in Release
  on 2026-09-25 (tests 25/25; SDK 29/29 in the bare app and 42/42 in the
  Expo app; iOS 27 simulator and Pixel 3a API 34 emulator); later runs
  covered the screens each task changed.
- **CI on main (2026-10-03):** every job green at `23cc5a1a` and
  `fe9758de`.

## Known limitations and deferred checks

<a id="deferred-checks"></a>

### Deferred checks (need the maintainer)

- **Physical devices (V8).** Nothing has run on a physical iPhone or
  Android phone: frame, latency, memory, lifecycle and trace evidence for
  every task, the T10 baselines, the T44 spike's frame results, the TB4
  migration's device run, and RTL on a device.
- **StoreKit `purchase()`.** It needs a `.storekit` configuration, which
  only runs launched by Xcode apply; the call compiles.
- **Pilots.** T68 and T69 need independent library authors and real apps.
- **Accessibility tooling.** VoiceOver was checked only through Mac
  Catalyst for the SwiftUI host; TalkBack and on-device VoiceOver are not
  run.
- **Older iOS.** SwiftUI hosting before iOS 16.4 and iOS 17 behavior are
  unverified (no simulator runtime); iOS before 17 uses a parent override
  for RTL traits.
- **Rotation.** Not run for the Compose host.
- **Android biometric prompt.** Showing a real prompt is not recorded; the
  design's gate for app integration asks for it.
- **react-native-screens.** Not in the example apps, so hosting inside its
  screens is untested.

### Project infrastructure

- **Vercel.** The "website" project's deploys fail, as they did before the
  Astro move; the "lucent" project serves the site. The project settings
  are the maintainer's.

### Views

- Views are behind the internal `LUCENT_VIEWS=fabric` switch, off by
  default.
- Android pools component views only when the app turns on React Native's
  `enableViewRecycling`; iOS always recycles them.
- Intrinsic sizes and slot insets wait for the JavaScript thread to apply
  them (one layout when idle).
- Absolute children of a padded component follow React Native's
  padding-box rule relative to the slot. A fixed-size slot inside a
  component sized by its children is bounded at three reports.
- With two React Native runtimes alive at once, requests are answered to
  the runtime that connected last.
- Helper view functions take plain data and scalar callbacks only: no
  toolkit values, children, lists or bindings inside a helper.
- SwiftUI: a static value named like a method (`Animation.easeInOut`) is
  left out, so write the call; only closed ranges (`a...b`) are mapped;
  content conditions must be `boolean`; `Int(x)` traps on NaN or infinity.
  A two-value `onChange` closure does not type-check, because TypeScript
  tries the one-value overload first.
- Compose: class names that clash keep the first package's.
- Native views' JSX (T48) has fixed children (conditional and keyed are
  [T49](#t49)'s) and no layout for a plain view's children until Yoga
  ([T50](#t50)); its rules read declarations, not behavior (Android's
  AdapterView declares `addView(View, int)` and throws from it).
- The iOS native-only slot move ([TA26](#ta26)) is open; the bare app's
  FlatList crash ([TA25](#ta25)) is in review.

### Language, runtime and bindings

- Reference cycles are not collected (see [Not planned](#not-planned)).
- Compute tasks are named top-level functions; safepoints are only in
  module functions' task variants. The JavaScript reference differs from
  native on `#private` fields (the copy loses them), subclass instances
  behind a base type (native throws `DataCloneError`), and an abort that
  lands after the task ran but before the promise settled (native rejects,
  JavaScript resolves).
- Module state is process-wide and reset when a new `Host` is created.
- On Android API 24 and 25, a Java default method that Lucent does not
  implement returns its zero value, and the reason is logged.
- A pod added to `lucent.json` after the first build needs `pod install`
  before it can be bound.
- Typed native extensions: Swift and Kotlin sources in a package are not
  typed yet, and extension calls cannot be cancelled.
- Tracing records allocations for native buffers only, and its buffer
  uses one mutex: fine for debugging, not for continuous production use.
- The known binding gaps are tasks [TA30](#ta30) to [TA34](#ta34).

## Design slices and tasks

The design specification delivers its work in slices S01–S23; this table
maps each slice to the tasks that carry it, so none is dropped. Task
details stay in this file; slice details stay in the
[design](docs/design/native-platform.md#18-implementation-slices-and-concrete-tests).

| Slice | Work                       | Tasks                                                        |
| ----- | -------------------------- | ------------------------------------------------------------ |
| S01   | Baseline                   | T00, T01, T02, T10                                           |
| S02   | Generated declarations     | T04, T12                                                     |
| S03   | Schema and provenance      | T03, T11, T13, T24                                           |
| S04   | Callback composition       | T06, T14                                                     |
| S05   | Awaitable migration        | T25, [T28](#t28)                                             |
| S06   | Swift acceptance           | T08, T17                                                     |
| S07   | Kotlin reader spike        | T07                                                          |
| S08   | Kotlin metadata and shims  | T15, T16, T26, T27                                           |
| S09   | Semantic IR                | T05, T18, T19                                                |
| S10   | Execution and lifetimes    | T06, T20, T21                                                |
| S11   | Isolated compute           | T29, T30                                                     |
| S12   | Buffers                    | T31, T32                                                     |
| S13   | Native extensions          | T22, T33                                                     |
| S14   | Lifecycle and context      | T34, T35, [T60](#t60)                                        |
| S15   | Fabric                     | T36, T37, T38, T39, T44                                      |
| S16   | UI reactive scopes         | T42, T43, T45                                                |
| S17   | Native wrappers            | T46, [T52](#t52)                                             |
| S18   | Sizing and slots           | T46, T47                                                     |
| S19   | JSX, layout and primitives | [T48](#t48), [T49](#t49), [T50](#t50), [T51](#t51)           |
| S20   | Demanding capabilities     | [T55](#t55), [T56](#t56), T57, T58, [T59](#t59), [T60](#t60) |
| S21   | IR optimization            | T53, [T54](#t54)                                             |
| S22   | Tooling                    | T09, T23, T24, T40, T41, [T61](#t61)                         |
| S23   | Production and adoption    | [T62](#t62)–[T70](#t70)                                      |

# Architecture summary

The design in brief, as built and as planned, moved here from ROADMAP.md
on 2026-10-08. The full
specification, with examples, call-direction tables, race cases and test
scenarios, is [docs/design/native-platform.md](native-platform.md);
the code-level description of what exists is
[docs/architecture.md](../architecture.md).

## From source to native code

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

## Bindings

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

## Execution and ownership

| Context      | Runs                                                                    | Rules                                                                                                                   |
| ------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Module actor | Exported functions and their async continuations, on the actor's thread | One fair lock per import component (a package): packages run in parallel; a nested wait that would close a cycle throws |
| Main         | Views, their effects and commands, main-thread SDK calls                | Never takes an actor's lock; runs on the platform's UI loop. Main-thread module entries never queue behind module jobs  |
| Compute      | `compute(task, input, { signal })`                                      | A bounded worker pool (cores − 1); checked tasks share no state                                                         |

- A promise resumes on the context that created it; a result from another
  thread is posted there. No context ever waits synchronously for another.
- Every pending operation carries a token (runtime, scope, generation,
  operation). Scopes dispose children, cancel operations and run cleanups
  in reverse order exactly once; a token from a disposed or recycled scope
  never revives it.
- Each JS runtime has its own `Host`. Reload invalidates it, cancels its
  work and rejects its promises while JavaScript can still observe them.
  Work belongs to the runtime whose call started it, so two runtimes at
  once keep their own; module variables are the process's, and a second
  runtime alongside a first shares them.
- `compute` runs a top-level function on a snapshot of its input. The
  compiler rejects tasks that touch module state, main-thread or unknown
  native code, or untracked functions (`LUCENT3011`), and inputs or
  results that are not data (`LUCENT3012`), naming the path.
- `NativeBuffer` holds bytes natively. `withRead` and `withWrite` lend
  scoped spans that cannot escape (`LUCENT3030`); `transfer()` and
  `compute` move ownership, and use after a move is reported
  (`LUCENT3031`). `Uint8Array` keeps its copy semantics.

## Views

A component is an exported function of a `.lucent.tsx` module. Its setup
runs once per mount on the main thread; React sees an ordinary component
with typed props, callback props for events, and a ref whose methods are
the commands the setup exposes. The design record is
[docs/design/views.md](views.md).

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

## Build and tooling

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

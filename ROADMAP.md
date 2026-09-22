# Roadmap

Where Lucent stands, what is being built next, and the evidence each step has to
produce.

Each milestone below opens with what is finished and the evidence that proves
it, then lists what is left. `[ ]` means incomplete — including work whose code
exists but whose acceptance test has not passed. A milestone stays open until
every item under it is gone. Contract metadata is never evidence that the
runtime behaviour it describes exists.

Updated 2026-09-22. 61 items remain open across M0–M9. The user-facing
introduction is in [README.md](README.md); what you can build today is in
[docs/language.md](docs/language.md).

## Where it stands

The compiler, both backends, both hosts and the toolchain are built and
exercised. Lucent covers call-in, call-out native work today: functions, native
classes with managed handles, cancellable background work, typed events,
declarative SwiftUI/Compose views, and synchronous delegate callbacks. What it
does not cover is work that outlives a call — subscriptions you register and
later remove, and resources you open and must close.

| Area                          | Status    | What is still missing                                                       |
| ----------------------------- | --------- | --------------------------------------------------------------------------- |
| Package cleanup               | Completed | Nothing; `std` and the bundled mini stdlib are gone                         |
| Native contracts              | Partial   | Remaining symbol kinds, runtime close enforcement, provenance               |
| Overload resolution           | Partial   | Contextual closure/literal arguments, availability ranking, ambiguity tests |
| Async object lifetime         | Partial   | SDK task adapters, host cancel/close races, runtime close quiesce           |
| Native closures               | Partial   | Closure-owned resource cells, indirect error-policy preservation            |
| Delegates and interfaces      | Partial   | Subscriptions, teardown quiescence, imported protocol conformance           |
| Lucent-owned component state  | Partial   | Component IR, `@State`/`remember` identity, resource slots, record events   |
| Keyed composition and effects | Partial   | Identity, reorder preservation, lazy collections, effects, refs             |
| Structured SDK extraction     | Partial   | Swift members/protocols, Clang/JVM/Kotlin adapters and overlays             |
| Camera acceptance feature     | Partial   | Permissions, preview, sessions, frame declarations, backpressure            |
| Release acceptance            | Open      | Four host/platform combinations and physical-device evidence                |

### Latest verification checkpoint

- 750 passing tests across 86 files. `pnpm verify` runs Swift and Kotlin fixture
  compilation plus eleven native executables, and builds and loads the shipped
  bundles.
- All four host/platform combinations were rebuilt and run: Expo/iOS, Expo/Android,
  Nitro/iOS and Nitro/Android report `ALL OK` on an iPhone 16 Pro simulator
  (iOS 18.2) and a Pixel 3a API 34 arm64 emulator.
- Code generation runs through a document tree that owns indentation and brace
  balance, with Swift and Kotlin expressions printed from typed ASTs. Two defects
  surfaced from that move: a call inside a conditional never received its `try`,
  and a parenthesisation mistake turned `total / (columns * rows)` into
  `(total / columns) * rows` — the second compiles and returns a different
  number, and only `verify-camera-frames` caught it, by running it.
- `verify-bundles.ts` builds and loads the packed artifacts, which nothing did
  before: a native file read through `import.meta.url` resolved beside the
  bundle, so the shipped CLI failed on import while every test passed.
- `COMPILER_VERSION` now comes from the compiler manifest. It had drifted to
  0.6.7 against a package at 0.0.1, and it keys both the CLI build cache and the
  Metro transform cache, so stale output could be served as fresh.

Android interaction is automated through `adb input`; the equivalent iOS
simulator automation needs `sudo xcode-select -s` on the build machine, so its
evidence is still manual.

## The goal

A developer should be able to author a substantial native feature in
`.lucent.ts` for logic, SDK interaction and native handlers, and `.lucent.tsx`
for components, state and lifecycle — compiled ahead of time to Swift and Kotlin
and exposed through both Expo Modules and Nitro, with no JavaScript runtime on
the native side.

**A camera preview is the acceptance test**, not a feature request: it needs SDK
objects, delegates, native buffers, concurrency, permissions and native UI
working together at once. Its processing algorithm and feature orchestration
must be written in Lucent. Adapters may handle SDK setup, buffer access,
permission plumbing and view hosting; they must not hold the feature's logic. A
preview rendered by a large handwritten native camera module does not count.

SDK coverage grows through package manifests and generated metadata, never
through a compiler fork. Registering a custom view or a native API is an
application's job, not the compiler's.

Out of scope for this delivery: general-purpose C/C++ FFI, arbitrary pointers,
GPU shader authoring, unrestricted inheritance, reflection, and complete SDK
coverage. Remaining coverage limits stay visible in the docs; there is no
blanket claim that every native API can be written adapter-free.

## Behavioural contracts

These rules govern every open item below. They are decisions, not proposals.

| Decision                  | Rule                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| JS handle disposal        | Invalidates new access immediately; idempotent; not synonymous with SDK resource close                      |
| In-flight operation       | Holds its own lease until actual completion, including cancellation completion                              |
| Resource close            | Explicit transition to closing: reject new work, quiesce/cancel owned work, run SDK cleanup on its executor |
| Borrowed value            | Cannot escape its declared scope or survive suspension without an explicit supported promotion or copy      |
| Thread safety             | Retention does not imply transferability; executor constraints apply independently                          |
| Immutable closure capture | Value types by value, object references with declared retention                                             |
| Mutable closure capture   | Explicit state/resource cells only; implicit escaping captures of ordinary mutable locals are rejected      |
| Delegate error            | Propagate only where the ABI allows it; otherwise a declared error route and return policy is required      |
| State initialization      | Once per component identity; prop changes do not rerun initializers                                         |
| Key change                | Dispose the old identity, create a new one                                                                  |
| Cancellation              | Cooperative; requesting cancellation is not proof that native work has stopped                              |
| Ambiguous overload        | Compiler error listing candidate signatures; declaration order never breaks a tie                           |

One behavioural contract and one shared test suite serve both hosts. Expo and
Nitro keep their own transport code, never their own ownership semantics.

## Next, in order

Ordered by what the camera acceptance feature actually blocks on. Each slice is
a coherent unit that can land green on its own.

### 0. Deterministic fake SDK — M0, 1 item

Mutable objects, async barriers, retained listeners, synchronous decisions,
UI-bound objects, borrowed buffers. Every slice below has to assert listener and
lifetime behaviour under races, and each `verify-*.ts` currently rebuilds a
throwaway SDK inline. Do this first or repeat the work four times.

### 1. Subscriptions and teardown — M4 tail, 4 items

Owned subscriptions with idempotent, reentrant-safe removal; retaining delegates
the SDK holds only weakly; quiescing in-flight delivery and releasing captures.
Frame delivery is a retained listener, so every M8 item that receives a frame
waits on this. The conformance generation underneath it is already green.

### 2. Explicit close and resource scopes — M3 tail, 4 items

Close that rejects new work, cancels and quiesces pending work, then runs SDK
cleanup on the required executor; externally owned resource detachment;
operation scopes wired to SDK cancellation adapters. A capture session is a
closeable resource, so session start/stop/interruption/close, backpressure and
Android frame closing all wait on this. Also closes the M1 enforcement item.

### 3. Component IR, resource slots and effects — M5/M6, ~10 items

Component definition and instance IR separate from view templates;
component-owned resource slots; dependency-scoped effects; instance-owned task
cancellation; mount, visibility and foreground separated. Required to author
camera orchestration in `.lucent.tsx`, and for the 100 mount/unmount cycles.

### 4. Camera package — M8, 9 items

Permissions, preview, typed sessions, borrowed frame declarations, scoped
processing, keep-latest backpressure, rate-limited results.

### 5. Device matrix and release — M8/M9, 8 items

Four host/platform pairs, physical-device evidence, and performance budgets
measured before they are set.

### Parallel tracks, not on the critical path

**M7 structured SDK extraction** (8 items). M8 builds the camera through public
package APIs, and curated manifests already carry delegates, enums and
references. Extraction lowers the cost of hand-authoring a manifest but blocks
none of slices 1–5. **M2's remaining items** (3) refine overload resolution
rather than enable anything the camera needs.

## Milestones

### M0 — Behavioural contracts and acceptance inventory

Done: ownership, disposal, cancellation, capture, identity and overload
semantics are recorded above. `.lucent.tsx`, HStack/VStack, AOT compilation and
native-only execution are preserved as architectural requirements.

- [ ] Freeze public source syntax for subscriptions, delegates, state, effects,
      resource scopes, close, and cancellation.
- [ ] Build a deterministic fake SDK with mutable objects, async barriers,
      retained listeners, synchronous decisions, UI-bound objects, and borrowed
      buffers.
- [ ] Specify typed error handling for authored recovery and nonthrowing native
      callbacks, including an explicit failure route rather than swallowed errors.

### M1 — Native manifest and contracts

Done: independent manifest `schemaVersion: 1` with unknown versions rejected;
stable ABI identity through `nativeSymbolId`; validated ownership, executor,
callback, cancellation and availability fields; minimum iOS/Android `targets`
carried from config through CLI, Metro, the cache key, IR and the generated
CocoaPods/Gradle files; availability checked inside platform guards; SDK enums
and option sets bridged through `LucentEnum_<Name>`; Metro's transform cache
invalidated when a manifest or target changes; conflicting native dependency
requirements rejected with both package specifiers.
Evidence: `native-contracts.test.ts`, `native-packages.test.ts`, typecheck.

- [ ] Exercise raised minimum targets in full native app builds, including
      conflicts with consumer-app settings.
- [ ] Cover the remaining symbol kinds: initializers, methods, properties,
      protocol/interface requirements, callbacks, generic specializations.
- [ ] Enforce call-level ownership, borrowed returns, callback retention, close,
      and executor contracts in compiler analysis and generated runtime behaviour.
      Four of five are enforced and tested — ownership, borrowed returns and
      use-after-close, callback retention, executors. Only `close` is
      outstanding, and only at runtime: it is a compiler error today, but nothing
      rejects new work, quiesces, then runs SDK cleanup. Closing this item means
      closing the M3 explicit-close item.
- [ ] Add full source/package/SDK provenance to contract diagnostics.

Schema, generator and extraction versions still ride on `COMPILER_VERSION` alone
and need their own fingerprints.

### M2 — Overload resolution

Done: public overload groups preserved in the linker; free functions,
constructors and instance methods resolved by arity and argument type before
lowering; exact matches ranked above nullable lifting and contextual numeric
literals; ambiguous and unmatched calls rejected with candidate signatures;
scalar overloads preserved through SDK text extraction with stable internal
aliases; generated TypeScript declarations carry one signature per overload and
the proxy dispatches on arity and runtime argument kind; enumerated lossless
numeric conversions lowered explicitly and executed at range boundaries.
Evidence: `overloads.test.ts`, SDK extraction tests, `verify-runtime.ts`.

- [ ] Contextually resolve closure/function-reference arguments and record/array
      literals without speculative checker side effects.
- [ ] Account for availability and shared cross-platform facade contracts.
- [ ] Test return-type-only ambiguity, null arguments, sized numeric boundaries,
      unavailable candidates, and editor/compiler declaration parity.

### M3 — Async references, disposal, and executors

Done: typed native object leases in Swift and Kotlin, with handle invalidation
separate from retention, idempotent close, lease groups with deduplication, and
zero remaining leases after 1,000 concurrent acquire/release operations per
target; verified Swift deallocation after the last lease closes; async reference
arguments accepted only for references marked owned, transferable and
executor-neutral; acquisition and deferred cleanup generated in both hosts; JS
transit retention so immediate `dispose()` rejects new calls while accepted calls
finish, shared across replacement wrappers and released exactly once; a native
cooperative `CancellationSource` and `@lucent-lang/core/tasks` scopes with
exactly-once completion and close that waits for real completion;
caller/main/worker/serial execution enforcement; per-object recursive locks
replacing registry-wide synchronization; borrowed escape and suspension checks.
Evidence: `lifetimes.test.ts`, `verify-interop.ts`, `runtime/test/objects.test.ts`,
`verify-cancellation.ts`, `verify-task-scopes.ts`, and all four example apps.

- [ ] Test multiple concurrent calls, returned-object ownership transfer,
      disposal before dispatch, disposal during suspension, reentrant callbacks,
      and native errors against both host implementations.
- [ ] Connect operation scopes to SDK-specific cancellation adapters; adapters
      must retain tasks and finish them on every real completion or error path.
      Disposing a handle does not close a scope or complete an SDK operation.
- [ ] Exercise cancellation during suspension and cancellation/close races
      against actual Expo/Nitro host scheduling.
- [ ] Implement explicit close: reject new work, cancel and quiesce pending work,
      then run SDK cleanup on the required executor.
- [ ] Define externally owned resource detachment and cleanup-error behaviour.

Rules this work has to keep: handle visibility, native object lifetime and SDK
resource state stay three distinct things — a handle can be invalid while a
started operation still safely retains the instance, and a resource can be
closing while its object is still allocated. A lease is acquired atomically with
handle validation, and any future handle reuse needs a generation check. Registry
locks protect registry bookkeeping only; never hold one across an SDK call,
suspension, executor hop or callback, and serialize non-thread-safe operations
through the object's declared executor instead. Race tests use controllable
completion barriers, never wall-clock sleeps.

### M4 — Native closures and delegates

Done: synchronous arrow closures with expression and statement bodies, typed
from annotations or a `NativeCallback` context; `value`, `retained` and
`weak(reference)` captures with mutable and resource captures rejected; explicit
capture-environment metadata in IR; escaping versus nonescaping distinction tied
to `retention: "call"`; callback executor requirements preserved through local
aliases, annotations, indirect invocation and subscription forwarding;
native-only SDK references for delegates and borrowed resources; concrete Swift
conformances and Kotlin implementations generated by `lucent sdk delegate` and
compiled against real protocol declarations; curated SDK resource parameters as
borrowed native-only inputs; mandatory typed fallback policies for nonthrowing
callbacks. Evidence: `verify-delegates.ts`, `verify-camera-frames.ts`.

- [ ] Support persistent state/resource cells inside closures, with lifetime
      checks. View `state()` is separate and listed under M5.
- [ ] Preserve the remaining callback error-policy contracts through indirect
      higher-order flows and add runtime executor acceptance tests.
- [ ] Import protocol/interface requirements and validate conformance.
- [ ] Extend delegate generation to inherited and optional requirements,
      availability, and protocol extraction.
- [ ] Model owned subscriptions with idempotent, reentrant-safe removal.
- [ ] Retain delegates even where the SDK keeps only weak references.
- [ ] Quiesce in-flight delivery and release captures on teardown.
- [ ] Run native listener/decision/delegate lifecycle acceptance tests.

### M5 — Lucent-owned state in `.lucent.tsx`

Done: typed `state(literal)` at the top level of a view, initialized once on the
host view instance and preserved across prop updates, read live from handlers so
`name.set(name + 1)` uses the current value; state writes and other effects
rejected during render; `TextField`, `Toggle` and `Slider` bound to view state or
props; conditional view expressions and eager `For` rows; both example apps use a
Lucent `FieldScreen` owning its controls. Android UI automation confirms typing
updates Lucent-owned `draft` state and that a parent prop update leaves `draft`,
`gain` and `armed` untouched.

- [ ] Introduce component definition/instance IR, separate from view templates.
- [ ] Generate SwiftUI `@State` and Compose `remember` inside the view value.
      Storage is a field on the generated host view instead.
- [ ] Support validated record event payloads without native resource leakage.
- [ ] Add component-owned resource slots separate from value state.

The component contract: definitions and instances belong in IR, not in view
string templates extended into a second hidden language. A definition describes
props, state slots, resource slots, handlers, render structure and effects;
instances have stable identities and ownership scopes. State initializes once per
identity, props are inputs that never overwrite it, and an explicit identity
change resets it. Updates run on the component's UI executor and the backend may
coalesce renders without changing update ordering. Controlled inputs bind to
state natively — a keystroke must not round-trip through JavaScript to keep a
native input current. SwiftUI ties state lifetime to view identity; that
constraint holds on both backends rather than falling out of where a wrapper
happens to sit.

### M6 — Composition, lifecycle, and references

Done: typed child slots — one `children: NativeView` prop receiving JSX children,
passed as an `AnyView` in SwiftUI and a `@Composable () -> Unit` in Compose;
keyed eager collections where `For` takes an optional `by` closure, with
duplicate keys reported in debug builds and disambiguated by position rather than
dropped.

- [ ] Define identity by parent, declaration, explicit key, and component type.
- [ ] Preserve state, focus and resources on reorder; clean up removed identities.
- [ ] Add lazy collections with explicit logical-state versus visibility lifetime.
- [ ] Add dependency-scoped effects: cleanup before restart, once on disposal.
- [ ] Cancel instance-owned tasks and reject stale completion updates.
- [ ] Separate mount, visibility, app foreground state, and temporary detachment.
- [ ] Add typed focus/scroll references with before-mount/after-dispose failures.
- [ ] Represent ordered modifiers in IR without changing wrapper semantics.
- [ ] Test recycling/reparenting and lifecycle equivalence in both hosts.

Planned surfaces once ordered modifiers land: `@lucent-lang/core/ui` for shared
layout and controls with documented cross-platform semantics, plus
`@lucent-lang/core/ui/swiftui` and `@lucent-lang/core/ui/compose` for
target-specific views, modifiers and bindings. A shared name must never silently
erase platform behaviour or an availability constraint; an API with no useful
shared meaning belongs in the platform-specific surface.

### M7 — SDK extraction and packages

Done: Swift compiler symbol graphs (format 0.6) read for public scalar free
functions, preserving native symbol IDs, labels and overloads, with generated
bindings compiled and executed from an actual compiler-produced test SDK;
per-symbol machine-readable coverage including unsupported declarations;
fingerprinted graph inputs recording extractor version, format, compiler
generator and platform metadata. Evidence: `verify-symbolgraph.ts`.

- [ ] Extend structured Swift extraction to members and protocols; add selected
      Clang/Objective-C adapters.
- [ ] Add JVM annotation/class-signature and Kotlin metadata extraction.
- [ ] Add curated ownership/executor/availability/callback overlays.
- [ ] Support enums, option sets, concrete generics, and inherited members.
- [ ] Extend coverage reporting to every other extraction adapter.
- [ ] Add equivalent toolchain/schema/overlay fingerprints for other adapters.
- [ ] Generate declarations, compiler metadata, and native manifests together.
- [ ] Extract and execute an overload and a protocol/interface from
      representative Apple and Android/Kotlin SDKs.

Structured toolchain metadata is the extraction source: Swift symbol graphs and
Clang declarations on Apple platforms, JVM class signatures, annotations and
Kotlin metadata on Android. The small text extractors stay as limited import
tools; they are not a foundation for complete SDK coverage.

### M8 — Camera acceptance feature

Done: a luminance processor compiled from `examples/camera/luminance.lucent.ts`
handling row and pixel stride, with Swift and Kotlin harnesses delivering 1,000
valid and malformed synthetic frame pairs through generated delegates, closing
every frame and verifying zero open frames; `@NativeOnly` exported processors for
sharing across `.lucent.ts` files without exposing frame-bearing signatures to
JavaScript. Physical camera delivery is not implemented by that harness.

- [ ] Create the camera package through public package APIs; no compiler camera tag.
- [ ] Implement Expo/Nitro-aware permission adapters, denial, retry, and recovery.
- [ ] Implement native preview and typed session start/stop/interruption/close.
- [ ] Declare borrowed frame planes, format, stride, orientation, and validity.
- [ ] Enforce scoped processing and explicit copying before asynchronous escape.
- [ ] Bound work to one frame in flight with keep-latest backpressure.
- [ ] Close Android frames on success, error, and cancellation.
- [ ] Deliver compact typed results with a configurable notification-rate limit.
- [ ] Author state, event handlers, and feature orchestration in `.lucent.tsx`.
- [ ] Test 100 mount/unmount cycles with zero remaining leases or subscriptions
      after quiescence. Blocked on subscriptions (M4) and component lifecycle
      (M6): there is nothing to mount or unmount yet.
- [ ] Run physical-device permissions, real frames, orientation, interruption,
      background/foreground, and device-loss tests for all four host/platform pairs.
- [ ] Record device/OS, p50/p95 processing time, drops, max in-flight work,
      teardown latency, and allocation trends before setting performance budgets.

Required checks include permission denial, repeated start/stop, rapid unmount
while a frame is processing, cancellation during startup, background/foreground,
SDK errors, slow consumers, rotated frames, padded strides and late callbacks.
Simulated frame sources give deterministic CI coverage; they do not replace
device tests.

Frame rules: image buffers stay native behind a scoped access abstraction
carrying pixel format, planes, row and pixel stride, orientation and validity. A
borrowed frame cannot be stored in component state, returned to JavaScript, or
held across suspension — asynchronous processing beyond the borrow needs an owned
copy. Keep one operation in flight with keep-latest backpressure; never
accumulate an unbounded queue of frames or JS events. Result delivery is rate
limited, with 10 updates per second as an initial product default rather than a
performance guarantee. Preview work stays on the UI executor while session and
processing operations stay on their declared executors.

### M9 — Verification, migration, and release

Done: the full unit suite, typecheck, lint, formatting, native fixture
compilation, SDK execution and interop execution run for every slice; both
examples regenerated and the native module compiled on both Android hosts and
both iOS apps, all reporting `ALL OK`.

- [ ] Add TSX/UI-toolchain fixture verification and iOS interaction automation.
- [ ] Add a deterministic concurrency/delegate harness and a physical-device suite.
- [ ] Test manifest upgrades, stale generated artifacts, and cache invalidation.
- [ ] Keep language docs, IR docs, this roadmap and website support claims
      aligned with verified behaviour.
- [ ] Complete every milestone gate before advertising the roadmap as finished.

## Verification

| Layer                   | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Compiler diagnostics    | Reject ambiguous overloads, escaping borrows, wrong executors, invalid state, bad boundaries |
| Golden fixtures         | Review IR and generated Swift/Kotlin for the same source contract                            |
| Native executable tests | Prove overload selection, closures, retention, cleanup, errors and state transitions         |
| Host contract tests     | Verify equivalent JS and native behaviour in Expo and Nitro                                  |
| UI interaction tests    | Prove state identity, bindings, lifecycle, focus and keyed behaviour                         |
| Device integration      | Prove camera permissions, real frames, interruption and platform lifecycle                   |
| Stress and benchmark    | Detect leaks, unbounded queues, deadlocks and sustained regressions                          |

`pnpm verify` checks the native embed is fresh, then runs typecheck, lint,
formatting, the unit suite, Swift and Kotlin fixture compilation, and the native
executables for runtime, interop, receivers, cancellation, enums, numeric
widening, symbol graphs, task scopes, delegates, camera frames and the shipped
bundles. Extend those scripts rather than replacing native execution with
snapshots.

### Working rules

1. Write contract and regression tests before the implementation, but commit only
   when tests and compilation pass. Do not create failing test-only commits.
2. Implement the checker and IR, then both backends and both hosts. Keep
   diagnostics conservative while a capability is incomplete.
3. Update `docs/language.md` in the same commit as the behaviour it describes,
   and `docs/ir.md` when the IR changes.
4. Run `pnpm verify` and `pnpm build:packages` before promoting a milestone.
5. Regenerate both example hosts and run the required native builds. A scalar
   fixture compilation cannot validate UI behaviour.
6. Regenerate generated native sources; never hand-edit them.
7. Keep a capability experimental until its acceptance gate passes. Update the
   docs and website support matrix only after the behaviour is verified.
8. Conventional Commits, imperative mood, titles at most 50 characters. No
   assistant co-author trailers. Do not push until asked.

Compatibility: HStack/VStack names, stateless TSX components, typed events,
curated bindings and package adapters stay. Breaking schema changes get a version
and a migration diagnostic. Old wrapper components are not silently reinterpreted
as ordered modifiers, and old metadata is never assumed thread-safe.

## Before 1.0

1. Publish `@lucent-lang/*` to npm and cut a 0.1.0. Nothing is on the registry
   today, so the documented `npx @lucent-lang/cli init` does not yet work.
2. Checker rule: a non-exported struct used in an exported signature is an error.
3. `Uint8Array` zero-copy on the Expo host, for synchronous functions.

## Definition of completion

Complete means a developer can create a stateful native feature, select SDK
overloads predictably, implement required native delegates, safely retain objects
across async work, compose keyed native UI, and build the camera feature through
the same public APIs available to any other package.

Both hosts must demonstrate equivalent documented behaviour. Unsupported cases
must fail with a useful diagnostic or go through a documented typed adapter.
Remaining SDK coverage limits stay visible in the support matrix.

## Done: the foundation

Kept as a record of how the pieces fit together.

- **Repository.** pnpm workspace, Vite+ toolchain, tsx, strict `tsconfig`,
  `AGENTS.md`. GitHub Actions run typecheck, lint, format and tests on Ubuntu and
  the Swift/Kotlin compile check on macOS. `lucent doctor` checks the toolchain
  and the project wiring.
- **`packages/compiler`** — pure, no IO: `compile(source, { fileName })` →
  `{ module, diagnostics }`. Closed surface AST over `oxc-parser`, `NativeType`
  resolution through lookup tables, a typed checker with a module symbol table,
  structured typed IR with a printed text form, and lowering that gives locals
  unique names, turns `for` into `while` and expands compound assignment.
  Diagnostics are a code table rendered as codeframes.
- **`packages/backend-swift` / `packages/backend-kotlin`** — IR to source text.
  Type mapping tables, `let`/`var` from IR mutability, `async throws` and
  `suspend`, statement-level `try`, labelled Swift calls, JS number semantics, and
  a runtime prelude contract the hosts fill in.
- **`packages/codegen`** — the emission document tree that owns indentation and
  brace balance, plus `fillNative`. It knows no IR and no target language.
- **`packages/host-expo`** — Expo SDK 58: `@ExpoModule` classes with `@JS` sync
  and `@JS(.concurrent)` async members, `@Record` structs, the Kotlin
  `definition()` DSL, `ArrayBuffer` bytes, the `modules/lucent/` package tree, and
  a JS proxy with generated `.d.ts`.
- **`packages/host-nitro`** — Nitro 0.37: generated `.nitro.ts` specs,
  `Hybrid<Name>` Swift and Kotlin implementations with bodies in `<Name>Bodies`
  namespaces, the `.lucent/nitro` package tree, and `nitrogen` run on generate.
- **`packages/cli`** — `build`, `check`, `init`, `doctor`, `explain`, `ir`,
  `clean`, `sdk`. Commands are data; help, validation and typo suggestions derive
  from it. Incremental cache keyed by compiler version, host and source.
- **`packages/metro`** — `withLucent(config, { host })`, an in-process transformer
  for `*.lucent.ts`, and a cache key that includes the compiler version, host,
  manifests and targets.
- **`packages/expo`** — the config plugin running the build into `modules/lucent/`
  during prebuild for both platforms.
- **Examples** — `apps/expo-example` and `apps/bare-example` share the same
  sources and assert every result on screen.

Hand-written Swift, Kotlin and build files live in each package's `native/` as
real source, embedded at build time by `scripts/embed-native.ts`; `pnpm verify`
checks the embed is fresh.

# Native interoperability implementation plan

Status: implementation in progress; the full acceptance feature is not complete.

Implemented foundation (2026-09-22): versioned contract validation, stable
symbol identities, overload selection for free functions, constructors and
instance methods, SDK enums and option sets, minimum SDK target checking and
native build propagation, immutable scalar callback captures, and typed
registry leases with native stress tests. Async host wrappers and JS transit
retention are implemented for explicitly owned, transferable, executor-neutral
SDK references. On the view side: Lucent-owned scalar state, controlled inputs,
conditional content, keyed `For` rows and typed child slots. The example checks
pass on Expo and Nitro on both iOS Simulator and Android emulator.

The bundled mini standard library (`crypto`, `filesystem`, `network`, `device`,
`platform/clock`, `platform/locale`) was removed along with the earlier `std`
package. Only byte, math and text primitives plus the `Platform.OS` guard and
the cancellation source remain built in; everything else is a package manifest,
which is the extension point every other SDK has to use anyway.

Still required for acceptance: complete ownership/executor enforcement and host
async acceptance, cancellation/resource scopes, mutable/resource closure captures,
delegates/interfaces, Lucent-owned state and keyed components, effects and
imperative refs, structured SDK metadata extraction, and the camera feature.
The contract fields introduced so far are not evidence that these runtime
behaviors are supported. Milestone gates below remain authoritative.
Prepared: 2026-09-22. Baseline: native interoperability foundation in `b826364`.
Delivery checklist: [completed and remaining work](native-implementation-todo.md).
Companion documents: [architecture](native-interop.md), [language](language.md),
and [IR](ir.md).

## 1. Outcome and scope

Enable developers to author substantial native features using `.lucent.ts` for
logic, SDK interactions, and native handlers, and `.lucent.tsx` for components,
state, and lifecycle. Generate Swift and Kotlin ahead of time and expose the
results through both Expo Modules and Nitro. No JavaScript runtime executes on
the native side.

The acceptance feature is a camera preview with native frame processing,
permission handling, lifecycle management, cancellation, and typed results sent
to React. Its processing algorithm and feature orchestration must be written in
Lucent. Platform adapters may handle SDK setup, native buffer access, permission
plumbing, and view hosting. They must not contain the feature's business logic.

This delivery does not promise that every platform API can immediately be
expressed without adapters. It establishes typed, enforceable extension
contracts and progressively moves behavior into Lucent. General-purpose C/C++
FFI, arbitrary pointers, GPU shader authoring, unrestricted inheritance,
reflection, and complete SDK coverage are outside the initial delivery.

All APIs, IR operation names, and file additions proposed below are design
candidates until milestone M0 freezes their contracts. Existing APIs remain
available until an explicit migration is implemented.

## 2. Current foundation and gaps

| Area         | Existing foundation                                                               | Required next step                                                                            |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| SDK objects  | Actual Swift/Kotlin SDK references, constructors, properties, methods, JS handles | Ownership, executor confinement, close semantics, async leases                                |
| Callbacks    | Synchronous named compiled functions, typed invocation, native-only bindings      | Capturing closures, escape checks, retained subscriptions, delegate implementations           |
| SDK metadata | Curated classes and scalar function extraction                                    | Stable symbol identities, overload sets, protocols, availability, structured extraction       |
| Components   | TSX view functions, shared controls, package view descriptors                     | Explicit component identity, persistent state, bindings, scoped effects                       |
| Collections  | Ordinary native loops                                                             | Declarative keyed children and lazy native lists                                              |
| Packages     | Native sources, CocoaPods/Gradle dependencies, capabilities                       | Versioned contracts, SDK requirements, source mapping, compatibility validation               |
| Validation   | Compiler/host tests, native execution checks, both example hosts                  | Deterministic concurrency tests, UI interaction tests, lifecycle stress tests, camera devices |

The previous implementation reported 403 tests passing and successful native
builds for both hosts. That is a historical baseline, not a claim that this
planning change reran those checks.

The existing blanket rejection of async shared-object arguments must remain
until the lease and executor implementation is available on both hosts.
Handwritten adapter-owned state is not completion of Lucent-owned state.
Distinct curated method names are not automatic overload resolution.

## 3. Architecture and responsibilities

Preserve the repository's one-way dependencies:

`cli / expo / metro → hosts → backends → compiler → parser`

| Layer                      | Responsibility                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiler                   | Pure metadata normalization, type checking, overload selection, ownership/escape analysis, execution effects, component semantics, typed IR |
| SDK tooling                | Toolchain invocation, symbol extraction, schema generation, declaration generation, curated metadata overlays                               |
| Backends                   | Deterministic emission from validated IR; Swift/Kotlin implementations of the same semantics                                                |
| Host core                  | Shared boundary contracts, package manifests, generated declarations and proxy behavior                                                     |
| Expo/Nitro hosts           | SDK-specific object retention, tasks, events, lifecycle, and view boundary wiring                                                           |
| CLI/Metro/Expo integration | File discovery, target configuration, dependency installation metadata, cache invalidation and diagnostics                                  |
| Native packages            | Platform adapters with explicit ownership, executor, availability, cleanup, and dependency contracts                                        |

Compiler code must not import filesystem APIs, SDK extractors, host packages,
or runtime implementations. Only the parser imports `oxc-parser`. Metadata
mappings, conversion policies, and diagnostic definitions remain data tables.

Avoid maintaining separate ownership semantics in Expo and Nitro. Define one
behavioral contract and shared test suite; retain host-specific transport code.
The compiler consumes data, never executes a native adapter to discover types.

## 4. Delivery sequence

| Milestone | Deliverable                                                | Depends on                                |
| --------- | ---------------------------------------------------------- | ----------------------------------------- |
| M0        | Frozen behavioral contracts and acceptance inventory       | Existing foundation                       |
| M1        | Versioned native symbol/type/availability schema           | M0                                        |
| M2        | Compile-time overload resolution                           | M1                                        |
| M3        | Ownership, leases, cancellation and object executors       | M1                                        |
| M4        | Capturing native closures and protocol/interface delegates | M2, M3                                    |
| M5        | Component IR and Lucent-owned reactive state               | M3, closure portion of M4                 |
| M6        | Keyed composition, effects, lifecycle and references       | M4, M5                                    |
| M7        | Broader metadata extraction and package compatibility      | M1; consumes M2/M4 as available           |
| M8        | Camera feature implemented through public Lucent APIs      | M2–M6 and the required curated SDK subset |
| M9        | Host parity, hardening, documentation and release gates    | M2–M8                                     |

M2 and M3 can progress independently after M1. Metadata extraction can start
once the schema is stable; it need not block curated camera bindings. A small
camera preview investigation can happen after M1 to discover SDK constraints,
but does not count as M8 completion. Calendar estimates should follow the contract review and initial native runtime
investigations.

Each milestone should be split into reviewable changes: contract tests first,
compiler/IR next, both backends, both hosts, integration, then documentation and
acceptance evidence. Do not promote a capability as supported after only one
backend emits plausible source.

## 5. M0 — Freeze semantics before syntax

### Work

1. Write the ownership, execution, callback, component identity, and overload
   contracts as small specification sections, with successful and rejected
   scenarios for each.
2. Inventory representative SDK operations: a mutable object, an async reader,
   a retained listener, a synchronous decision delegate, a UI-bound object,
   and a borrowed camera frame.
3. Specify the source authoring model. Recommended defaults are function-style
   TSX components, explicit compiler-recognized state/effect operations,
   typed closures, and declared protocol/interface conformance. Continue using
   decorators for execution annotations; do not reintroduce comment annotations.
4. Separate an instance being mounted from being visible or the application
   being foregrounded. Effects and camera activation must not conflate them.
5. Define how typed native errors, cancellation, and unhandled delegate errors
   appear at native and JavaScript boundaries.
6. Decide serialization rules for state and events. Start state with concrete
   supported scalars and value records. Native resources belong to explicit
   component-owned resource slots, not arbitrary serializable state fields.

### Required decisions

| Decision                  | Recommended initial rule                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| JS handle disposal        | Invalidate new access immediately; idempotent; not synonymous with SDK resource close                           |
| In-flight operation       | Holds its own lease until actual completion, including cancellation completion                                  |
| Resource close            | Explicit transition to closing; reject new work; quiesce/cancel owned work; perform SDK cleanup on its executor |
| Borrowed value            | Cannot escape its declared scope or survive suspension without an explicit supported promotion/copy             |
| Thread safety             | Retention does not imply transferability; executor constraints apply independently                              |
| Immutable closure capture | Capture value types by value and object references with declared retention                                      |
| Mutable closure capture   | Initially allow explicit state/resource cells; reject implicit escaping captures of ordinary mutable locals     |
| Delegate error            | Propagate only where the ABI allows it; otherwise require a declared error route and return policy              |
| State initialization      | Once per component identity; changes to props do not rerun initializers                                         |
| Key change                | Dispose the old identity and create a new one                                                                   |
| Cancellation              | Cooperative; requesting cancellation is not proof that native work has stopped                                  |
| Ambiguous overload        | Compiler error with candidate signatures; never use declaration order                                           |

### Gate

A reviewed behavioral specification, unresolved choices listed explicitly, and
an acceptance-test inventory. Public spelling is secondary to these semantics.
No new implementation behavior is claimed at this milestone.

## 6. M1 — Native symbol and contract schema

### Compiler and SDK work

- Introduce a versioned schema with stable symbol IDs independent of Lucent
  aliases, source offsets, and extraction order. Include framework/module,
  owning declaration, native signature identity, and target ABI information.
- Represent constructors, static and instance methods, properties, enums,
  option sets, protocol/interface requirements, and callback signatures.
- Model reference ownership and parameter passing separately. A type can be a
  reference while a particular parameter is borrowed for one call.
- Describe synchronous/asynchronous completion, callback retention, required
  executor, supported cancellation, and cleanup operations.
- Record platform and minimum SDK availability, native argument labels,
  nullability, and supported generic specializations.
- Treat absent ownership or executor information as unknown. Require curated
  annotations before enabling operations that depend on that information.
- Normalize legacy `LibraryModule` metadata into the new model. Preserve its
  existing synchronous behavior; do not infer async safety from native names.
- Keep effectful operations explicit in typed IR: selected native calls,
  closures/capture environments, scope cleanup, executor transitions, and
  resource acquisition/release. Final operation names are chosen in M0/M1.

### Package and integration work

- Version the native manifest independently from the compiler package version.
- Carry minimum SDK and package compatibility requirements through config,
  host generation, and actionable build diagnostics.
- Reject incompatible dependency requirements with package provenance. Do not
  silently choose a conflicting pod or Android dependency version.
- Include schema, adapter contents, target settings and generator versions in
  cache keys. Add fixtures proving each input invalidates generated output.
- Keep generated declarations and native metadata tied to the same normalized
  schema so editor types cannot drift from compiler behavior.

### Primary areas

`compiler/src/libraries.ts`, `library-validation.ts`, `types/`, `checker/`,
`ir/`, `sdk/src/`, `config/src/`, `host-core/src/config.ts`,
`host-core/src/native-packages.ts`, and CLI/Metro cache handling.

### Tests and gate

Deterministic symbol IDs; schema version rejection; legacy manifest behavior;
unknown ownership diagnostics; invalid metadata; target version mismatch;
capability propagation through callbacks and packages; cache invalidation.
A curated schema must describe all representative M0 APIs without embedding
ownership decisions in raw body strings.

## 7. M2 — Automatic overload resolution

### Work

1. Retain overload groups in the linker instead of discarding duplicate public
   names or requiring every candidate to have a separate source alias.
2. Resolve against arity, receiver type, argument types, nullability, native
   labels represented by the source API, and target availability.
3. Specify a deterministic ranking table. Prefer exact matches; permit only
   enumerated lossless conversions. Preserve `number` as the existing default
   numeric type. Require explicit sized types when selection would otherwise
   depend on an unsafe numeric narrowing.
4. Define contextual typing for literals and closures. Select one candidate
   before lowering; report all remaining viable signatures on ambiguity.
5. Store the selected symbol ID and argument conversions in IR. Do not ask
   Swift or Kotlin independently to decide a Lucent overload.
6. Keep return-type-only overloads unsupported initially. Defer general generic
   inference; support only declared specializations with concrete signatures.
7. Separate native overload resolution from the JS export ABI. Prefer concrete
   exported wrappers initially. A JS dispatcher is allowed only when runtime
   argument shapes distinguish all variants without guessing numeric types.
8. Define cross-platform groups explicitly. A shared facade may map to different
   platform symbols, but its Lucent contract must be the same on both targets.

### Tests and gate

Constructors and methods; exact versus widening conversions; null arguments;
explicit sized numerics; callback overloads; ambiguous literals; unavailable
candidates; stable selection after metadata reordering; declaration parity.
Execute generated calls on both toolchains and prove the intended overload was
invoked. A source diagnostic must replace every ambiguous selection.

## 8. M3 — Async references, ownership and executors

### Handle and operation state machines

Keep handle visibility, native object lifetime, and SDK resource state distinct.
A handle can be invalid while an already-started operation still safely retains
the native instance. A resource can be closing even while its object remains
allocated.

Use a lease acquired atomically with handle validation. Acquiring a lease after
handle invalidation fails. Existing leases are released on every completion
path. Prevent stale handles from becoming valid for a different object; any
future handle reuse must include a generation check.

Registry locks protect registry bookkeeping only. Never hold a registry-wide
lock across SDK calls, suspension, executor hops, or callbacks. Serialize
non-thread-safe SDK operations using the object's declared executor instead.

### Implementation steps

1. Add deterministic fake native resources and controllable completion barriers
   for race tests; do not use wall-clock sleeps as the synchronization mechanism.
2. Implement per-operation retention and exactly-once completion/cleanup in the
   native runtimes and both host adapters.
3. Add ownership and escape checks for return values, field storage, closure
   captures, and suspension points. Initially reject uncertain cases.
4. Lower cleanup scopes for normal return, throw, cancellation, and early exits.
   Plan explicit typed error handling where authored code needs recovery;
   cleanup correctness must not rely on developers remembering a final release.
5. Add cooperative cancellation tokens and scope-owned operation tracking.
   Handle success-versus-cancel races and native callbacks arriving after a
   cancellation request. Suppress results for disposed owners while still
   completing native cleanup.
6. Implement caller, main, worker, and declared serial-object execution rules.
   Do not automatically mark arbitrary Swift SDK objects as Sendable or move
   thread-confined objects into detached tasks to satisfy compiler errors.
7. Model explicit resource close. For owned resources, closing rejects new work,
   requests cancellation where supported, waits asynchronously for quiescence,
   and invokes SDK cleanup on the required executor. Externally owned resources
   are detached according to their contract, not unconditionally closed.
8. Lift async reference restrictions only for contracts both backends and hosts
   implement. Unknown legacy bindings retain their existing restrictions.

### Primary areas

Compiler ownership/effect analysis and lowering; backend `objects.ts` and async
emission; `runtime/src/objects.ts`; host class/async bridges; error normalization.

### Tests and gate

Dispose-before-start, dispose-during-await, repeated disposal, callback reentry,
cancel-before-start, cancel-during-work, success/cancel races, SDK errors,
wrong-executor use, borrowed value escape, handle identity, and cleanup errors.
Assert zero live leases after every deterministic case. Run the same host
contract suite against Expo and Nitro. Never block the main thread waiting for
work scheduled back onto the main thread.

## 9. M4 — Capturing closures and native delegates

### Closure implementation

- Parse and type-check a constrained arrow/function-expression subset with
  concrete parameter and return types. Keep ordinary JavaScript values out of
  capture environments.
- Record captures explicitly in typed IR: immutable value, retained reference,
  supported weak reference, or persistent state/resource cell.
- Distinguish nonescaping and escaping callbacks using the callee's contract.
  Reject borrowed captures that would outlive their scope and unsupported
  mutable local captures.
- Emit native closure environments with deterministic release. A weak capture
  must be explicitly nullable and handled by source code.
- Preserve throws, execution requirements, capabilities and availability through
  indirect calls; anonymous functions must not bypass existing safety checks.

### Delegate implementation

1. Import protocol/interface requirement identities from metadata. Validate
   conformance, required methods, argument labels, return types and availability.
2. Generate concrete Swift conformance and Kotlin interface implementation.
   Support only the required native base classes and initialization patterns in
   the first version. General inheritance/override dispatch is a later feature.
3. Represent delegate registration as an owned subscription with idempotent
   removal. Retain delegates even when an SDK stores only a weak reference.
4. Model callback delivery already in progress during removal. Detach future
   delivery, quiesce current delivery where required, then release captures.
5. Keep synchronous delegate decisions native. A required synchronous result
   cannot await JavaScript or silently hop to another executor. Incompatible
   executor contracts are diagnostics or require an explicit adapter.
6. Require an error policy for nonthrowing ABI callbacks: typed notification,
   documented fallback result, cancellation, or another supported SDK-specific
   route. Never silently drop an exception or invent a return value.

### Tests and gate

Captured value/reference behavior; rejected borrowed captures; strong-cycle
cleanup; weak delegate storage; synchronous return values; optional versus
required methods; double removal; reentrant removal; callback failure; wrong
executor; callback after owner disposal; native-only boundary enforcement.
A listener can be declared in Lucent, registered with a native test SDK, return a
synchronous decision, and release all captures after teardown on both platforms.

NativeScript's protocol/interface authoring is a useful comparison, but Lucent
must generate the conformance ahead of time rather than execute handlers in a
JS runtime. See [NativeScript subclassing](https://docs.nativescript.org/guide/subclassing/).

## 10. M5 — Component IR and Lucent-owned state

### Component contract

Introduce component definitions and instances in IR rather than extending view
string templates into a second hidden language. Component definitions describe
props, state slots, resource slots, handlers, render structure, and effects.
Instances have stable identities and ownership scopes.

State is initialized once for an identity. Props are inputs refreshed on host
updates; changing props does not overwrite existing state. Explicit identity
changes reset state. Derived values recompute from current state/props without
becoming independently owned state unless requested.

### Implementation steps

1. Keep function-style `.lucent.tsx` authoring and add compiler-recognized state
   operations. Initially require state declarations in a statically identifiable
   top-level component position; diagnose conditional declarations.
2. Lower reads/writes to persistent typed cells. Event handlers must see current
   values, including after prop updates. Define ordered functional updates so
   multiple updates cannot lose increments through stale captures.
3. Generate a SwiftUI component with stable native storage and a Compose
   component with equivalent remembered storage. Existing stateless render
   functions continue to work.
4. Define mutation and invalidation semantics: updates occur on the component's
   UI executor; observable state changes invalidate dependent rendering; the
   backend may coalesce renders without changing update ordering.
5. Connect state to controlled inputs through typed bindings. Avoid routing each
   native keystroke through JS simply to keep a native input's state current.
6. Expand typed event payloads to the validated value-record subset needed by
   real features. Keep borrowed frames and native references out of event JSON.
7. Preserve source locations for state, render, and generated handler failures.
   Reject effects during render; do not permit state writes to cause render loops.
8. Define native resource slots separately from value state. An instance-owned
   subscription or session is disposed through the component ownership scope.

### Tests and gate

Initialization once; state surviving prop changes and unrelated renders;
functional updates; current handler captures; multiple instances remaining
independent; identity reset; controlled input editing without JS state storage;
main-executor enforcement; render purity; cleanup after component disposal.

Replace the adapter-owned example counter with a Lucent-authored stateful
component in both apps. Exercise text input and counter interaction through UI
automation, including a parent prop update that must not reset the counter.

SwiftUI explicitly relates state lifetime to view identity; this is a semantic
constraint to preserve across both backends, not an implementation detail to
leave to incidental wrapper placement. See [Demystify SwiftUI](https://developer.apple.com/videos/play/wwdc2021/10022/).

## 11. M6 — Keyed composition, lifecycle and imperative references

### Composition

- Add conditional content, typed child slots, reusable component instances, and
  keyed collection nodes. Keep component nodes distinct from ordinary loops.
- Define identity using parent scope, stable declaration location, explicit key,
  and component type. Keys are unique among siblings, not globally.
- Require stable scalar keys for stateful lists. Reject duplicate keys with a
  useful development diagnostic; avoid array indices as implicit identities for
  reorderable collections.
- Preserve state and active resources when an item moves within its scope.
  Removing an identity releases its resources. Reintroducing it later creates
  new state unless an explicit persistence feature is added.
- Distinguish eager keyed collections from virtualized lists. Define logical
  item-state retention separately from whether a native cell is currently on
  screen. For the first lazy implementation, keep item state at collection scope
  while the item remains in the data; visibility-scoped work may stop offscreen.

Compose also treats keys as local to a call site. Use its native identity
mechanisms while preserving Lucent's documented cross-platform contract.
See [Compose lifecycle](https://developer.android.com/develop/ui/compose/lifecycle).

### Lifecycle and references

1. Add scoped effects with explicit dependency values, cleanup before restart,
   and exactly-once disposal. Define equality for dependencies; avoid implicit
   deep comparison of native objects.
2. Cancel component-owned async tasks on disposal and prevent stale completion
   from updating a newer instance with the same source location.
3. Distinguish mount/dispose, visibility, foreground/background, and temporary
   native host detachment. Test React Native recycling and reparenting behavior.
4. Add typed component references for declared commands such as focus/scroll.
   Calls before mount or after disposal fail predictably; no raw view pointers
   cross into JavaScript.
5. Represent ordered modifiers in IR with package descriptors for validation
   and target emission. Preserve existing layout-wrapper behavior rather than
   silently changing it into different modifier semantics.
6. Reserve shared APIs for intentional common behavior; preserve platform-only
   controls/modifiers behind target restrictions and explicit imports.

### Tests and gate

Reorder editable rows while preserving value/focus; insert/delete/filter;
duplicate keys; conditionally mounted state; lazy offscreen behavior; changing
component type at a key; effect dependency changes; stale async completion;
focus before/after mount; repeated mount/unmount; modifier ordering.
Run behavioral tests against both hosts, including real user interaction.

## 12. M7 — Structured SDK extraction and package compatibility

### Work

- Add an Apple extraction adapter using Swift symbol graphs and appropriate
  Clang/Objective-C metadata for the selected framework subset. Do not assume a
  documentation symbol graph alone contains complete ABI or ownership data.
- Add a JVM adapter using class signatures and annotations, supplemented by
  Kotlin metadata for Kotlin-specific declarations. Keep toolchain invocation
  outside the compiler. Kotlin documents its metadata inspection APIs in the
  [Kotlin Metadata JVM guide](https://kotlinlang.org/docs/metadata-jvm.html).
- Maintain curated overlays for ownership, executor, callbacks, availability,
  error policies and SDK quirks that cannot be inferred reliably.
- Add enums and option sets, then concrete generic specializations and inherited
  members with explicit symbol identity. Track unsupported declarations in a
  machine-readable coverage report with precise reasons.
- Pin supported toolchain/schema versions. Cache extracted artifacts by input
  SDK fingerprints, targets, extraction version, and overlay version.
- Generate `.d.ts`, compiler metadata and native adapter manifests together.
  Verify deterministic output and distinguish public APIs from inaccessible
  native members.
- Reconcile minimum SDK versions with app settings. A platform OS guard alone
  must not authorize an API unavailable on the configured OS version. Add
  version-availability guards only when both checking and native emission exist.
- Extend source provenance so diagnostics identify the imported package and SDK
  declaration, not only a generated internal symbol.

### Gate

Extract and compile representative symbols from one Apple framework and one
Android/Kotlin library, including an overload and protocol/interface. Missing
contract metadata produces an actionable requirement or rejection, never a
claim of complete coverage. The camera may use curated metadata until this
extraction coverage is ready.

## 13. M8 — Camera acceptance feature

### Package boundary

Create a normal camera package using the public native package system. The
compiler must not know a special camera tag or hard-code camera operations.
Provide a shared session/preview contract and explicit platform-specific APIs
where AVFoundation and CameraX do not have equivalent behavior.

The permission adapter is host-aware: Expo and Nitro expose different app and
activity integration surfaces. Capability configuration supplies manifest/plist
requirements; it does not substitute for runtime permission requests.

### Incremental implementation

| Step | Scope                   | Required evidence                                                             |
| ---- | ----------------------- | ----------------------------------------------------------------------------- |
| C1   | Permissions and preview | Grant, deny, later retry/settings recovery; correct native layout             |
| C2   | Session lifecycle       | Start/stop, interruption, foreground/background, idempotent close             |
| C3   | Frame delivery          | Typed borrowed frame, dimensions/format/stride/orientation, executor contract |
| C4   | Lucent processor        | Algorithm compiled from `.lucent.ts`; deterministic known-frame outputs       |
| C5   | Results and native UI   | Typed compact results to React and Lucent-owned state in `.lucent.tsx`        |
| C6   | Stress and failures     | Slow processing, repeated mounting, cancellation, device loss, cleanup        |

### Ownership and processing rules

- Keep image buffers native. Expose a scoped frame access abstraction that
  carries pixel format, planes, row/pixel stride, orientation and validity.
- Start with a supported luminance-plane operation, avoiding an accidental
  tightly-packed-buffer assumption. Add explicit copy/retention operations only
  for adapters that can actually guarantee the advertised lifetime.
- A borrowed frame cannot be saved into component state, returned to JS, or held
  across arbitrary suspension. Scoped native processing runs before release;
  asynchronous processing beyond the borrow requires an owned copy or supported
  explicit retention.
- Start with one processing operation in flight and keep-latest backpressure.
  Bound pending work; never accumulate an unbounded queue of frames or JS events.
- Define a configurable result delivery limit; a proposed initial sample default
  is 10 updates per second. This is a product policy, not a performance guarantee.
- Close Android analysis frames on success, error, and cancellation paths.
  CameraX documents the keep-latest mode, lifecycle binding and the need to call
  `ImageProxy.close()` in its [image analysis guide](https://developer.android.com/media/camera/camerax/analyze).
- Keep preview work on the UI executor and session/processing operations on their
  declared executors. Confirm the exact AVFoundation operation requirements
  against the pinned SDK; see [AVCaptureSession.startRunning](<https://developer.apple.com/documentation/avfoundation/avcapturesession/startrunning()>).

### Acceptance matrix

Run the same feature in Expo/iOS, Expo/Android, Nitro/iOS and Nitro/Android.
Real camera and interruption testing requires physical devices; simulated frame
sources provide deterministic CI coverage but do not replace those tests.

Required checks include permission denial, repeated start/stop, rapid unmount
while a frame is processing, cancellation during startup, background/foreground,
SDK errors, slow consumers, rotated frames, padded strides, and late callbacks.

Proposed stress gates: 100 mount/unmount cycles and at least 1,000 synthetic frame
lifecycles with zero outstanding tracked leases, subscriptions, or frames after
quiescence. Measure process memory and native allocations over repeated runs to
detect a sustained growth trend; do not require exact process-memory equality.
Record device/OS, resolution, processing p50/p95, dropped-frame counts, maximum
in-flight work and teardown latency. Set performance budgets from the first
measured baseline before claiming a supported throughput target.

### Completion rule

The algorithm, state, event handling and feature lifecycle orchestration are
Lucent-authored. Adapters are limited to justified SDK/ABI/platform integration.
A review must identify any feature logic left in adapters and explain why.
A preview rendered by a large handwritten native camera module is insufficient.

## 14. M9 — Verification, migration and release

### Test layers

| Layer                   | Purpose                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Compiler diagnostics    | Reject ambiguous overloads, escaping borrows, wrong executors, invalid component state and unsupported boundaries |
| Golden fixtures         | Review IR and generated Swift/Kotlin for the same source contract                                                 |
| Native executable tests | Prove selected overloads, closure behavior, retention, cleanup, errors and state transitions                      |
| Host contract tests     | Verify equivalent JS/native behavior in Expo and Nitro                                                            |
| UI interaction tests    | Prove state identity, bindings, lifecycle, focus and keyed behavior                                               |
| Device integration      | Prove camera permissions, real frames, interruption and platform lifecycle                                        |
| Stress/benchmark tests  | Detect leaks, unbounded queues, deadlocks and sustained regressions                                               |

Extend the current verification scripts rather than replacing native execution
with snapshots. Add a native concurrency/delegate harness and a separate device
suite. Keep fast deterministic checks in normal development; document the
physical-device release suite and archive its results.

### Repository workflow

1. Write contract/regression tests before implementation, but commit only when
   tests and compilation pass. The user's green-only instruction overrides the
   older tests-first commit rule in `AGENTS.md`.
2. Implement checker/IR, then both backends and hosts. Preserve conservative
   diagnostics while a capability is incomplete.
3. Update `docs/language.md` in the same implementation commit as behavior;
   update `docs/ir.md` when the IR changes.
4. Run relevant tests, typecheck, lint and formatting checks. Before a milestone
   is promoted, run `pnpm verify` and `pnpm build:packages`.
5. Regenerate both example hosts and perform required native builds. Extend the
   existing fixture discovery to TSX/component fixtures with the native UI
   toolchains; ordinary scalar fixture compilation cannot validate UI behavior.
6. Add upgrade tests for versioned schemas, generated declarations, cache keys,
   stale artifacts and dependency changes. Regenerate rather than manually edit
   generated native sources.
7. Keep capabilities experimental until the milestone's acceptance gate passes.
   Update the supported-feature matrix in documentation and the website only
   after the behavior is verified.
8. Use Conventional Commits with titles at most 50 characters. Do not add
   assistant co-author trailers. Do not push until explicitly requested.

### Compatibility policy

Preserve HStack/VStack names, stateless TSX components, current typed events,
curated bindings and native package adapters. Version breaking schema changes
and supply diagnostics/migration guidance. Do not silently reinterpret old
wrapper components as ordered modifiers or old metadata as thread-safe.

## 15. Review-sized implementation backlog

The following are proposed changes, not claims of completed work. Commit each
finished feature or milestone slice together with its passing tests.

| Change | Main scope                                                  | Completion evidence                             |
| ------ | ----------------------------------------------------------- | ----------------------------------------------- |
| 01     | Behavioral contracts and native test SDK inventory          | M0 decisions recorded                           |
| 02     | Schema versioning, identities, legacy normalization         | Deterministic metadata and migration fixtures   |
| 03     | Execution/ownership/availability metadata and diagnostics   | Invalid contracts rejected                      |
| 04     | Overload groups, selection, selected-call IR                | Native overload execution tests                 |
| 05     | Registry leases and handle invalidation                     | Deterministic disposal races                    |
| 06     | Task scopes, cancellation, cleanup and object executors     | Both host async suites                          |
| 07     | Closure parser, capture analysis, closure IR                | Native closure execution and escape diagnostics |
| 08     | Delegate conformance, subscriptions and error policies      | Synchronous delegate and teardown tests         |
| 09     | Component IR, instance identity and state cells             | Stateful Lucent counter on both hosts           |
| 10     | Native bindings, current handlers and record event payloads | Interactive input tests                         |
| 11     | Keyed collections and typed child composition               | Reorder preserves state/focus                   |
| 12     | Scoped effects, resource slots and imperative references    | Unmount and stale-completion tests              |
| 13     | Ordered modifiers and target-specific component APIs        | Ordering/availability tests                     |
| 14     | Structured metadata extraction and overlays                 | Real SDK subset and coverage report             |
| 15     | Camera preview and permission adapters                      | Four host/platform configurations               |
| 16     | Lucent frame processor and typed results                    | Known frames, bounded work, native execution    |
| 17     | Camera lifecycle stress, diagnostics and benchmarks         | Device evidence and resource accounting         |
| 18     | Compatibility, docs, examples and release matrix            | All acceptance gates satisfied                  |

Entries 14 and the camera preview investigation can be developed earlier after
their dependencies are stable. No schedule should assume delegates, lifetimes,
state or camera support is complete merely because its syntax parses.

## 16. Definition of completion

The roadmap is complete when a developer can create a stateful native feature,
select SDK overloads predictably, implement required native delegates, safely
retain objects across async work, compose keyed native UI, and integrate the
camera feature through the same public APIs available to other packages.

Both hosts must demonstrate equivalent documented behavior. Unsupported cases
must fail with useful diagnostics or use a documented typed adapter. Remaining
SDK coverage limitations must be visible in the support matrix, with no blanket
claim that all native APIs or every complex feature can be written adapter-free.

# Native interoperability implementation checklist

Updated: 2026-09-22, after an audit of every open item against the code and its
named evidence. Scope: [implementation plan](native-implementation-plan.md).

This is the delivery checklist, not a list of advertised capabilities. `[x]`
means the stated item is implemented and has the evidence named below. `[ ]`
means incomplete, including work whose code exists but whose acceptance tests
have not passed. A partially implemented milestone remains open.

No changes have been pushed. Commit each completed feature or milestone slice
only after its tests and compilation pass. Do not create failing test-only
commits. This user instruction overrides the older tests-first commit rule in
`AGENTS.md`. Do not add assistant co-author trailers.

## Current status

| Area                          | Status    | What is still missing                                                       |
| ----------------------------- | --------- | --------------------------------------------------------------------------- |
| Package cleanup               | Completed | `std` and the bundled mini stdlib are gone; the rest carry real layers      |
| Native contracts              | Partial   | Remaining symbol kinds, runtime close enforcement, provenance               |
| Overload resolution           | Partial   | Contextual closure/literal arguments, availability ranking, ambiguity tests |
| Async object lifetime         | Partial   | SDK task adapters, host cancel/close races, runtime close quiesce           |
| Native closures               | Partial   | Closure-owned resource cells; indirect error-policy preservation            |
| Delegates/interfaces          | Partial   | Subscriptions, teardown quiescence, imported protocol conformance           |
| Lucent-owned component state  | Partial   | Component IR, `@State`/`remember` identity, resource slots, record events   |
| Keyed composition and effects | Partial   | Identity, reorder preservation, lazy collections, effects, refs             |
| Structured SDK extraction     | Partial   | Swift members/protocols, Clang/JVM/Kotlin adapters and overlays             |
| Camera acceptance feature     | Partial   | Permissions, preview, sessions, frame declarations, backpressure            |
| Release acceptance            | Open      | Four host/platform combinations and physical-device evidence                |

Four rows moved off `Not implemented` in the audit, against evidence that was
already green. Delegates: nine of seventeen M4 items are done and
`verify-delegates.ts` executes generated conformances on both toolchains. Keyed
composition: typed child slots and keyed eager collections are done and tested.
Camera: the luminance processor and `@NativeOnly` sharing are done, and
`verify-camera-frames.ts` runs 1,000 synthetic frame pairs through generated
delegates on both toolchains. Overload resolution and native closures keep
their status, but their missing-work column named items that are now `[x]`.

## Package cleanup

- [x] Audit `packages/std`: its math/text declarations are useful, but the
      standalone package is redundant.
- [x] Move math declarations to `packages/core/math.d.ts`.
- [x] Move text declarations to `packages/core/text.d.ts`.
- [x] Export `@lucent-lang/core/math` and `@lucent-lang/core/text`.
- [x] Preserve the existing native implementations and migrate compiler lookup
      entries, fixtures, examples, website snippets, and language documentation.
- [x] Remove `packages/std` and all workspace dependencies on it.
- [x] Update the lockfile and compile the migrated native fixtures.
- [x] Audit the remaining declaration-only packages against real import sites.
      `types`, `objects`, `events`, `ui`, `config` and `platform` remain useful
      authoring surfaces, now merged into core subpaths. Their standalone
      packages are removed.
- [x] Remove the bundled mini standard library: `crypto`, `filesystem`,
      `network`, `device`, `platform/clock` and `platform/locale` were
      hand-written native modules, not language features, and they hid the
      package extension point that has to carry every other SDK. The example
      apps declare the same operations in `native/toolkit.library.json`, so the
      device evidence is preserved and now also proves a third-party package.
      Removes the `clock` and `locale` capabilities, which gated nothing.
- [x] Pack `core` and type-check both new imports in an isolated consumer using
      only the archive contents. Refresh the workspace installation offline.

Evidence: compiler library tests; regenerated `native-stdlib` fixtures;
`verify-native.ts`; workspace typecheck. This migration removes the old package
specifier; the migration paths are documented in `docs/language.md`.

## M0 — Behavioral contracts and acceptance inventory

- [x] Record the proposed ownership, disposal, cancellation, capture, identity,
      and overload semantics in the implementation plan.
- [x] Preserve `.lucent.tsx`, HStack/VStack, AOT compilation, and native-only
      execution as architectural requirements.
- [ ] Freeze public source syntax for subscriptions, delegates, state, effects,
      resource scopes, close, and cancellation.
- [ ] Build a deterministic fake SDK with mutable objects, async barriers,
      retained listeners, synchronous decisions, UI-bound objects, and borrowed
      buffers.
- [ ] Specify typed error handling for authored recovery and nonthrowing native
      callbacks, including an explicit failure route rather than swallowed errors.

## M1 — Native manifest and contracts

- [x] Add independent manifest `schemaVersion: 1` and reject unknown versions.
- [x] Add stable ABI identity construction with `nativeSymbolId`.
- [x] Validate call ownership/executor/callback/cancellation/availability fields.
- [x] Validate native reference ownership/executor/transferability fields.
- [x] Reject parameter contracts naming nonexistent declaration parameters.
- [x] Keep legacy synchronous libraries accepted without inferring async safety.
- [x] Add minimum iOS/Android `targets` to config and compiler options.
- [x] Propagate targets through CLI/Metro compilation and the CLI cache key.
- [x] Check reachable native call availability within platform guards.
- [x] Carry targets into IR and generated CocoaPods/Gradle build files.
- [x] Verify the generated CocoaPods deployment-target expression against the
      installed CocoaPods specification API.
- [ ] Exercise raised minimum targets in full native app builds, including
      conflicts with consumer-app settings.
- [x] Cover enums and option sets: manifest `enums` declare cases plus a native
      type and per-case expression for each target, validated against the
      declared string-literal union. Cases are string literals in source, the
      SDK value in native code, and the case name across the JavaScript
      boundary through a generated `LucentEnum_<Name>` bridge.
- [ ] Cover the remaining symbol kinds: initializers, methods, properties,
      protocol/interface requirements, callbacks, generic specializations.
- [ ] Enforce call-level ownership, borrowed returns, callback retention, close,
      and executor contracts in compiler analysis and generated runtime behavior.
      Four of the five are enforced and tested: ownership (`native-references`),
      borrowed returns and use-after-close (`lifetimes`), callback retention
      (`borrowed-callbacks`), executors (`callback-executors`). Only `close` is
      outstanding, and only at runtime — it is a compiler error today, but
      nothing rejects new work, quiesces, and then runs SDK cleanup. Closing
      this item means closing the M3 explicit-close item.
- [ ] Add full source/package/SDK provenance to contract diagnostics.
- [x] Invalidate Metro's transform cache when an app's library manifests or
      minimum targets change. The CLI cache already hashed them; Metro's key was
      only the compiler version and host, so editing a manifest served stale
      proxies. Schema, generator and extraction versions still ride on
      `COMPILER_VERSION` alone and need their own fingerprints.
- [x] Reject differing native dependency requirements with both package
      specifiers in the error. Shared pods and Android modules require identical
      requirements; even overlapping ranges must be explicitly aligned. No
      range solver or implicit SDK upgrade is claimed. Generation is atomic on
      conflict, and classifiers share their Android module's version check.

Evidence: `native-contracts.test.ts`, `native-packages.test.ts`, typecheck.
Contract metadata alone is not proof that the described runtime behavior exists.

## M2 — Overload resolution

- [x] Preserve public overload groups in the linker.
- [x] Resolve supported free-function candidates by arity and argument types.
- [x] Prefer exact matches over nullable lifting and contextual numeric literals.
- [x] Reject ambiguous/no-match calls with candidate signatures.
- [x] Lower the selected concrete operation before Swift/Kotlin generation.
- [x] Preserve supported scalar overloads during SDK text extraction.
- [x] Emit stable internal SDK aliases independently of extraction order.
- [x] Generate public TypeScript overload declarations from those signatures.
- [x] Execute a selected extracted `java.lang.Math.abs` overload in native
      verification, preserving platform guards on the other target.
- [x] Support automatic constructor and instance-method overload groups.
      Candidates share an `overload` group named `Name__create` or
      `Name__method_<name>`; `new Name(...)` and `object.name(...)` select one
      concrete operation before lowering. Constructor overloads must be
      separable by arity or runtime argument kind, since `new` is one
      JavaScript function; the proxy dispatches on that and the generated
      declaration carries one TypeScript constructor per overload.
- [x] Preserve public instance-method names and dispatch JavaScript calls by
      arity and argument kind in both hosts. Verify synchronous and asynchronous
      overloads, receiver retention, nullable arguments, unmatched calls, and
      rejection of signatures JavaScript cannot distinguish.
- [x] Add enumerated lossless numeric SDK-argument conversions in typed IR,
      lower them to explicit Swift/Kotlin conversions, and rank exact overloads
      above widening. Execute every permitted conversion at range boundaries
      and reject narrowing/sign/precision loss. Container/optional conversions
      remain unsupported.
- [ ] Contextually resolve closure/function-reference arguments and record/array
      literals without speculative checker side effects.
- [ ] Account for availability and shared cross-platform facade contracts.
- [ ] Test return-type-only ambiguity, null arguments, sized numeric boundaries,
      unavailable candidates, and editor/compiler declaration parity.

Evidence: `overloads.test.ts`, SDK extraction tests, `verify-runtime.ts`.

## M3 — Async references, disposal, and executors

- [x] Add typed native object leases in Swift and Kotlin.
- [x] Keep handle invalidation separate from native object retention.
- [x] Make lease close idempotent and reject access through a closed lease.
- [x] Add lease groups with duplicate-handle deduplication and cleanup when only
      part of a group can be acquired.
- [x] Verify native identity, invalid/released handles, closed leases, and zero
      remaining leases after 1,000 concurrent acquire/release operations per target.
- [x] Verify actual Swift object deallocation after the last lease closes.
- [x] Accept async reference arguments only for SDK references explicitly marked
      owned, transferable, and executor-neutral; preserve conservative rejection
      for ordinary mutable shared classes and unknown legacy contracts.
- [x] Generate acquisition and deferred/finally cleanup in Expo and Nitro async
      wrappers. Nitro acquires before scheduling its promise.
- [x] Extend transit retention to asynchronous SDK instance methods, including
      receivers, arguments, awaited native result conversion, and native rejection.
      Emit Promise-returning method declarations for both hosts.
- [x] Add JS transit retention so immediate `dispose()` rejects new calls while
      accepted async calls retain their handles through dispatch and completion.
- [x] Test success and synchronous failure during JS transit retention.
- [x] Build and execute the new async wrappers with the actual Expo and Nitro
      SDKs on iOS 18.2 Simulator and Android 14 emulator. All four examples
      report `ALL OK`, including immediate-disposal checks.
- [x] Unit-test parallel JS dispatch and transfer to a new returned wrapper after
      the original wrapper is disposed.
- [x] Keep transit retention shared across replacement wrappers. Disposing a
      replacement waits for calls accepted by both old and new wrappers, including
      rejected calls, and releases the native handle exactly once.
- [x] Execute concurrent calls followed by immediate disposal and rejection of
      new work in all four host/platform example combinations.
- [ ] Test multiple concurrent calls, returned-object ownership transfer,
      disposal before dispatch, disposal during suspension, reentrant callbacks,
      and native errors against both host implementations.
- [x] Add a native cooperative `CancellationSource` with synchronized/atomic
      state, idempotent cancellation, typed `CANCELLED` checkpoints, and explicit
      async transferability. Execute concurrent cancellation on both toolchains.
- [x] Add `@lucent-lang/core/tasks` operation tracking with synchronized task
      records, cancellation requests, exactly-once completion, and asynchronous
      close that waits for actual completion. Execute repeated close and concurrent
      completion on Swift and Kotlin.
- [ ] Connect operation scopes to SDK-specific cancellation adapters; adapters
      must retain tasks and finish them on every real completion/error path.
      Disposing a handle does not close a scope or complete an SDK operation.
- [ ] Exercise cancellation during suspension and cancellation/close races
      against actual Expo/Nitro host scheduling.
- [x] Define exactly-once completion under success/cancel races on
      `CancellationSource.finish()`. Close races against SDK cleanup are not
      included.
- [x] Add caller/main/worker/serial-object execution enforcement.
- [x] Replace registry-wide synchronization around synchronous SDK calls with
      appropriate object/executor serialization; do not hold registry locks while
      invoking arbitrary SDK code or callbacks. Retained snapshots survive handle
      disposal; per-object recursive locks serialize synchronous bridge entry,
      and multi-object calls acquire locks in stable order. Verify independent
      calls, same-object mutation, same-thread reentry, error cleanup, and Swift
      deinitialization outside the registry lock.
- [x] Implement borrowed reference escape and suspension checks.
- [ ] Implement explicit close: reject new work, cancel/quiesce pending work,
      then run SDK cleanup on the required executor. Use-after-`close` is now a
      compiler error; runtime quiesce and SDK cleanup are not.
- [ ] Define externally owned resource detachment and cleanup-error behavior.

Evidence: `lifetimes.test.ts`, `verify-interop.ts`, async-reference host tests,
`runtime/test/objects.test.ts`, `verify-cancellation.ts`. Arbitrary SDK task
adapters and full SDK cleanup quiescence remain incomplete.

## M4 — Native closures and delegates

- [x] Parse synchronous arrow expression bodies and single-return bodies.
- [x] Type parameters from annotations or a `NativeCallback` context.
- [x] Allow immutable scalar `const` captures and reject mutable/resource captures.
- [x] Lower closure expressions to IR and emit Swift/Kotlin closures.
- [x] Execute a captured callback on both native toolchains.
- [x] Add explicit capture-environment metadata to IR.
- [x] Support statement bodies, value captures, and retained owned references.
- [x] Support weak captures. `weak(reference)` is an optional capture of an
      immutable owned reference, and the closure must handle null. Immutable
      non-reference records use the `value` capture rule.
- [ ] Support persistent state/resource cells inside closures, with lifetime
      checks. View `state()` is separate and listed under M5.
- [x] Distinguish escaping and nonescaping callback captures. `retention: "call"`
      may capture a borrow; `subscription` and absent retention may not.
- [x] Preserve callback executor requirements through local aliases, annotations,
      indirect invocation, and subscription forwarding. Check direct callback
      bodies in the declared delivery executor, not the registration executor.
- [ ] Preserve the remaining callback error-policy contracts through indirect
      higher-order flows and add runtime executor acceptance tests.
- [x] Add native-only SDK references for delegates and borrowed SDK resources.
      SDK-owned references need no fictitious constructor; callback-taking
      constructors remain compiled-only, and bridge exposure is rejected.
- [ ] Import protocol/interface requirements and validate conformance.
- [x] Generate concrete Swift conformances and Kotlin implementations for
      curated scalar delegate requirements via `lucent sdk delegate`. Compile
      both generated implementations against real test protocol/interface
      declarations and invoke callbacks authored in Lucent.
- [x] Support curated SDK resource parameters as borrowed, native-only
      delegate inputs. Reject return, storage, retained-call and escaping
      callback capture; allow scoped helpers and explicitly nonescaping callbacks.
- [ ] Extend delegate generation to inherited/optional requirements, availability
      and protocol extraction.
- [ ] Model owned subscriptions with idempotent, reentrant-safe removal.
- [ ] Retain delegates even where the SDK keeps only weak references.
- [ ] Quiesce in-flight delivery and release captures on teardown.
- [x] Require explicit typed fallback policies with reasons for nonthrowing
      generated delegate callbacks. Throwing Swift requirements may explicitly
      propagate; invalid/missing policies fail generation.
- [ ] Run native listener/decision/delegate lifecycle acceptance tests.

## M5 — Lucent-owned state in `.lucent.tsx`

- [ ] Introduce component definition/instance IR, separate from view templates.
- [x] Add typed `state(literal)` operations at the top level of a view. Nested
      and non-literal declarations are rejected.
- [x] Initialize that state once on the host view instance and preserve it
      across prop updates. Keyed identity reset is not implemented.
- [x] Read the live cell from handlers, so `name.set(name + 1)` uses the current
      value.
- [ ] Generate SwiftUI `@State` and Compose `remember` inside the view value.
      Storage is a field on the generated host view instead.
- [x] Reject state writes and other effects during render. Handler closures may
      update state. UI-executor hopping is not a separate check.
- [x] Bind `TextField`, `Toggle`, and `Slider` to view state, or to props.
- [x] Allow conditional view expressions and eager `For` rows over string,
      number, and boolean arrays. Row identity is the index.
- [ ] Support validated record event payloads without native resource leakage.
- [ ] Add component-owned resource slots separate from value state.
- [x] Replace the adapter-owned counter in both example apps with a Lucent
      `FieldScreen` that owns its controls and a `FieldKit` class for the log.
- [x] Exercise text editing and a parent prop update through UI automation on
      the Android emulator: typing into the native `TextField` updates the
      Lucent-owned `draft` state, and appending two sample rows from React
      leaves `draft`, `gain` and `armed` untouched. iOS automation still needs
      the simulator tooling enabled on the build machine.

## M6 — Composition, lifecycle, and references

- [x] Add typed child slots. A component may declare one `children: NativeView`
      prop that receives its JSX children; several children group vertically.
      SwiftUI passes an `AnyView`, Compose a `@Composable () -> Unit`. A
      component with a slot is Lucent-only and gets no React component or
      declaration, since React owns a host view's children.
- [ ] Define identity by parent, declaration, explicit key, and component type.
- [x] Add keyed eager collections with duplicate-key diagnostics. `For` takes an
      optional `by` closure from the row value to a string; SwiftUI uses
      `ForEach(_:id:)` over the keyed rows and Compose wraps each row in `key`.
      A duplicate key is reported in debug builds and disambiguated by position
      rather than dropping the row.
- [ ] Preserve state/focus/resources on reorder; clean up removed identities.
- [ ] Add lazy collections with explicit logical-state versus visibility lifetime.
- [ ] Add dependency-scoped effects: cleanup before restart, once on disposal.
- [ ] Cancel instance-owned tasks and reject stale completion updates.
- [ ] Separate mount, visibility, app foreground state, and temporary detachment.
- [ ] Add typed focus/scroll references with before-mount/after-dispose failures.
- [ ] Represent ordered modifiers in IR without changing existing wrapper semantics.
- [ ] Test recycling/reparenting and lifecycle equivalence in both hosts.

## M7 — SDK extraction and packages

- [x] Read Swift compiler symbol graphs (format 0.6) for public scalar free
      functions, preserving native symbol IDs, labels, and overloads. Compile and
      execute generated bindings from an actual compiler-produced test SDK.
- [ ] Extend structured Swift extraction to members and protocols; add selected
      Clang/Objective-C adapters.
- [ ] Add JVM annotation/class-signature and Kotlin metadata extraction.
- [ ] Add curated ownership/executor/availability/callback overlays.
- [ ] Support enums, option sets, concrete generics, and inherited members.
- [x] Emit per-symbol machine-readable coverage for structured Swift graphs,
      including unsupported declarations and all-unsupported inputs.
- [ ] Extend coverage reporting to every other extraction adapter.
- [x] Fingerprint structured Swift graph inputs and record extractor version,
      format, compiler generator, and platform metadata.
- [ ] Add equivalent toolchain/schema/overlay fingerprints for other adapters.
- [ ] Generate declarations, compiler metadata, and native manifests together.
- [ ] Extract and execute an overload and protocol/interface from representative
      Apple and Android/Kotlin SDKs.

## M8 — Camera acceptance feature

- [ ] Create the camera package through public package APIs; no compiler camera tag.
- [ ] Implement Expo/Nitro-aware permission adapters, denial, retry, and recovery.
- [ ] Implement native preview and typed session start/stop/interruption/close.
- [ ] Declare borrowed frame planes, format, stride, orientation, and validity.
- [x] Compile a luminance processor from `.lucent.ts` with known-frame tests.
      `examples/camera/luminance.lucent.ts` handles row and pixel stride. Native
      Swift/Kotlin harnesses deliver 1,000 valid/malformed synthetic frame pairs
      through generated delegates, close every frame, and verify zero open
      frames. Physical camera delivery is not implemented by this harness.
- [x] Add `@NativeOnly` exported processors for sharing across `.lucent.ts` files
      without exposing frame-bearing signatures to JavaScript.
- [ ] Enforce scoped processing and explicit copying before asynchronous escape.
- [ ] Bound work to one frame in flight with keep-latest backpressure.
- [ ] Close Android frames on success, error, and cancellation.
- [ ] Deliver compact typed results with a configurable notification-rate limit.
- [ ] Author state, event handlers, and feature orchestration in `.lucent.tsx`.
- [x] Test 1,000 synthetic frames with zero remaining frames after quiescence.
      `verify-camera-frames.ts` delivers 1,000 valid/malformed pairs through
      generated delegates on both toolchains and asserts every frame is closed.
- [ ] Test 100 mount/unmount cycles with zero remaining leases or subscriptions
      after quiescence. Blocked on subscriptions (M4) and component lifecycle
      (M6); there is nothing to mount or unmount yet.
- [ ] Run physical-device permissions, real frames, orientation, interruption,
      background/foreground, and device-loss tests for all four host/platform pairs.
- [ ] Record device/OS, p50/p95 processing time, drops, max in-flight work,
      teardown latency, and allocation trends before setting performance budgets.

## M9 — Verification, migration, and release

- [x] Preserve the no-push instruction. Use green-only feature/milestone commits
      under the latest user instruction; do not commit failing tests.
- [x] Run typecheck, lint, formatting, unit tests, native fixture compilation,
      SDK execution, and interop execution for the initial foundation.
- [x] Rerun the full unit suite, typecheck, lint, native fixture compilation, SDK
      execution, and interop execution after async bridge/transit changes: 426 tests.
- [x] Regenerate both examples and compile the native module on both Android
      hosts and both iOS apps. Both iOS simulator apps report `ALL OK`.
- [x] Build/install both full Android apps and verify `ALL OK` on the emulator.
- [ ] Add TSX/UI-toolchain fixture verification and iOS interaction automation.
      Android interaction is automated through `adb input`; the iOS simulator
      tooling on this machine needs `sudo xcode-select -s`, so its interaction
      evidence is still manual.
- [ ] Add a deterministic concurrency/delegate harness and physical-device suite.
- [ ] Test manifest upgrades, stale generated artifacts, and cache invalidation.
- [ ] Keep language, IR, implementation checklist, and website support claims
      aligned with verified behavior.
- [ ] Complete every milestone gate before advertising the roadmap as finished.

## Next execution order

Ordered by what the camera feature actually blocks on. 62 items remain open;
each numbered slice below is a coherent unit that can land green on its own.

The audit changed no totals. It moved four status rows off `Not implemented`
against evidence that was already green, and split one camera item whose two
halves were in different states — the 1,000-frame run is done, the 100
mount/unmount cycles cannot start until there is a component to mount.

0. **Deterministic fake SDK** (M0, 1 item). Mutable objects, async barriers,
   retained listeners, synchronous decisions, UI-bound objects, borrowed
   buffers. Every slice below needs to assert listener and lifetime behaviour
   under races, and each `verify-*.ts` currently rebuilds a throwaway SDK
   inline. Do this first or repeat that work four times.

1. **Subscriptions and teardown** (M4 tail, 4 items). Owned subscriptions with
   idempotent reentrant-safe removal; retaining delegates the SDK holds only
   weakly; quiescing in-flight delivery and releasing captures. Frame delivery
   is a retained listener, so every M8 item that receives a frame waits on
   this. The conformance generation underneath it is already green.

2. **Explicit close and resource scopes** (M3 tail, 4 items). Close that
   rejects new work, cancels and quiesces pending work, then runs SDK cleanup
   on the required executor; externally owned resource detachment; operation
   scopes wired to SDK cancellation adapters. A capture session is a closeable
   resource, so M8 session start/stop/interruption/close, backpressure and
   Android frame closing all wait on this. Also closes the M1 enforcement item.

3. **Component IR, resource slots and effects** (M5/M6, ~10 items). Component
   definition/instance IR separate from view templates; component-owned
   resource slots; dependency-scoped effects; instance-owned task cancellation;
   mount, visibility and foreground separated. Required for authoring camera
   orchestration in `.lucent.tsx`, and for the 100 mount/unmount cycles.

4. **Camera package** (M8, 9 items). Permissions, preview, typed sessions,
   borrowed frame declarations, scoped processing, keep-latest backpressure,
   rate-limited results.

5. **Device matrix and release** (M8/M9, 8 items). Four host/platform pairs,
   physical-device evidence, performance budgets measured before they are set.

Not on the critical path: **M7 SDK extraction** (7 items). M8 builds the camera
"through public package APIs", and curated manifests already carry delegates,
enums and references. Extraction reduces the hand-authoring cost of that
manifest but blocks none of slices 1–5, so it can run in parallel or later.
The same is true of the remaining **M2** items, which refine overload
resolution rather than enable anything camera needs.

## Latest verification checkpoint

- Unit suite: 750 passing tests across 86 files. `pnpm verify` runs the Swift
  and Kotlin fixture compilation plus eleven native executables, and now also
  builds the shipped bundles and loads each one.
- Code generation moved off string concatenation: hand-written native source
  lives in `packages/*/native` and is embedded at build time, emission goes
  through a document tree that owns indentation and brace balance, and Swift
  and Kotlin expressions are printed from typed ASTs. Two defects came out of
  it. A call inside a conditional never received its `try`, so that Swift did
  not compile and no fixture reached it. A parenthesisation mistake turned
  `total / (columns * rows)` into `(total / columns) * rows`, which compiles
  and returns a different number; `verify-camera-frames` caught it by running.
- Two verification gaps closed. `verify-receivers.ts` pins that a Lucent class
  is a reference, which nothing executed. `verify-bundles.ts` builds and loads
  the packed artifacts, which nothing did — a native file read through
  `import.meta.url` resolved beside the bundle, so the shipped CLI failed on
  import while every test passed.
- `COMPILER_VERSION` now comes from the compiler manifest. It had drifted to
  0.6.7 against a package at 0.0.1, and it keys both the CLI build cache and
  the Metro transform cache, so stale output could be served as fresh.

### Checkpoint before the code-generation slice

- Unit suite: 648 passing tests across 80 files after callback executor propagation,
  borrowed frame callbacks,
  shared native-only processors, strided luminance verification, curated delegate generation,
  native-only SDK resources,
  per-object bridge serialization,
  JavaScript method overload
  dispatch, nullable signature checks, native task scopes, async
  SDK method retention, public package consolidation,
  authoring declarations and JSX key-selector corrections, diagnostic namespacing,
  native adapter dependency validation, lossless numeric SDK arguments, and
  structured Swift SDK extraction.
- Full `pnpm verify` and package compilation pass, including execution of every
  allowed numeric widening at its range boundaries on Swift and Kotlin, plus
  real Swift symbol graph extraction and generated binding execution. Task scope
  verification covers cancellation/completion races, concurrent completion,
  repeated close, rejection after close, and waiting for all accepted work.
- Website build passes with updated SDK extraction and overload documentation.
- Regenerated and compiled both example apps on iOS and Android after bridge
  serialization changes: all four builds pass. This is compilation evidence,
  not a new simulator/emulator interaction run or physical-device camera run.

### Previous full application checkpoint

- Unit suite after that slice: 554 passing tests across 68 files. Typecheck,
  lint and formatting pass. `pnpm verify` runs the Swift and Kotlin fixture
  compilation, the extracted-SDK execution, the interop and lease stress check,
  the cancellation check and the new enum check; all pass on Swift 6.4 and
  Kotlin 2.4.20.
- Package build and website build: passing.
- All four host/platform combinations were rebuilt and run for this slice:

  | Combination     | Result                                                       |
  | --------------- | ------------------------------------------------------------ |
  | Expo / iOS      | `Contract passed`, 0 build errors, iPhone 16 Pro on iOS 18.2 |
  | Expo / Android  | `Contract passed`, Pixel 3a API 34 arm64 emulator            |
  | Nitro / iOS     | `Contract passed`, same simulator                            |
  | Nitro / Android | `Contract passed`, same emulator                             |

  Every check passes on all four, including the package bindings that replaced
  the removed built-ins: `native SHA-256`, `filesystem worker roundtrip` and
  `package device binding`.

- Interaction evidence on the Android emulator, driven through `adb input`:
  tapping `Record sample` twice appended two rows to the keyed `For` list and
  left the component's own `draft`, `gain` and `armed` state untouched across
  the parent prop update; typing into the native `TextField` changed the
  Lucent-owned `draft` state and its mirrored label. The equivalent iOS
  automation is still missing.
- A stale Metro server from an earlier session served the old transformer and
  reported the pre-rename `NT` codes. That was an environment issue, not a
  product one, but it exposed a real gap: Metro keyed transforms on the
  compiler version and host only, so an edited manifest or target served stale
  proxies. Fixed in this slice.

These results cover the implemented subset. They do not close the outstanding
delegate, component-IR, lifecycle, extraction, or camera gates.

### Cooperative cancellation slice

The compiler accepts the built-in cancellation source across async boundaries.
Native executable tests verify the initial state, the `CANCELLED` error, repeated
cancellation, and 1,000 concurrent cancellation requests on Swift and Kotlin.
Child `scope()` sources observe parent cancellation, and `finish()` is true once
and false after cancellation or a second completion. Borrowed results cannot be
returned, stored, or used after suspension or `close`. Calls must match
`main`, `worker`, or caller-confined `serial` executors. Closure IR records
`value` and `retained` captures, including statement bodies.

Operation scopes for arbitrary SDK work, host-scheduler cancel races, delegate
subscriptions, component state, extraction, and the camera feature remain open.

### Replacement-wrapper retention slice

Regression tests cover overlapping calls on old and replacement wrappers,
disposal of both wrappers, and success/error completion of the older call.
The handle stays retained until all accepted calls settle and is released once.
Full verification and package compilation pass. This is a JS transit-lifetime
fix; host suspension, executor enforcement, and resource scopes remain open.

### Explicit diagnostic namespace

- [x] Replace abbreviated compiler diagnostic prefixes with `LUCENT` while
      preserving numeric identities. Update CLI code lookup, category grouping,
      coloring, structured output, fixtures, language docs, and website examples.
- [x] Bump the compiler cache version so cached proxies cannot retain old codes.

- [x] Consolidate public authoring/runtime/integration imports under
      `@lucent-lang/core`, with the CLI separate. Remove standalone declaration
      and configuration packages without backwards-compatible import aliases.
      Update init/doctor, examples, generated proxies and documentation.
- [x] Keep compiler/backend/host implementations as internal dependencies.

### Native package integration

- [x] Remove the stale namespace restriction on registered adapters. Scoped,
      unscoped, and subpath package names compile through explicitly registered
      native manifests. Unregistered JavaScript imports remain rejected.
- [x] Preserve originating package specifiers in native package IR and include
      them in dependency conflicts for both Expo and Nitro.

### Single public package verification

- [x] Pack core and typecheck its authoring/config/runtime/integration imports in
      a separate consumer directory. Core comes from the tarball; internal
      implementation dependencies come from the built workspace, not npm.
- [x] Resolve the core Metro entry and the core Expo entry through Expo's real
      plugin resolver. Typecheck both example apps and build the website.
- [x] Add scalar state declarations and use `For by={...}` for identity selectors;
      JSX `key` is reserved by React. Reject the old selector name.

Internal implementation packages still need publishing as transitive
dependencies; this does not claim a registry installation was tested.

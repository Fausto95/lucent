# Native interoperability implementation checklist

Updated: 2026-09-22. Scope: [implementation plan](native-implementation-plan.md).

This is the delivery checklist, not a list of advertised capabilities. `[x]`
means the stated item is implemented and has the evidence named below. `[ ]`
means incomplete, including work whose code exists but whose acceptance tests
have not passed. A partially implemented milestone remains open.

No changes have been pushed. Commit each completed feature or milestone slice
only after its tests and compilation pass. Do not create failing test-only
commits. This user instruction overrides the older tests-first commit rule in
`AGENTS.md`. Do not add assistant co-author trailers.

## Current status

| Area                          | Status          | What is still missing                                                      |
| ----------------------------- | --------------- | -------------------------------------------------------------------------- |
| Package cleanup               | Completed       | `std` and the bundled mini stdlib are gone; the rest carry real layers     |
| Native contracts              | Partial         | Remaining symbol kinds, enforcement, cache coverage, provenance            |
| Overload resolution           | Partial         | Methods/constructors, callback contexts, conversions, availability ranking |
| Async object lifetime         | Partial         | SDK task scopes, host cancel/close races, runtime close quiesce            |
| Native closures               | Partial         | Closure-owned resource cells; indirect executor/error preservation         |
| Delegates/interfaces          | Not implemented | Conformance, subscriptions, delivery/error policies                        |
| Lucent-owned component state  | Partial         | Component IR, `@State`/`remember` identity, resource slots, record events  |
| Keyed composition and effects | Not implemented | Identity, keyed/lazy collections, effects, refs                            |
| Structured SDK extraction     | Not implemented | Apple/JVM metadata adapters and curated overlays                           |
| Camera acceptance feature     | Not implemented | Permissions, preview, sessions, frames, Lucent processor                   |
| Release acceptance            | Open            | Four host/platform combinations and physical-device evidence               |

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
      `types`, `objects`, `events`, `ui`, `config`, `core` and `platform` each
      back a distinct compiler-recognised import surface and stay.
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
- [ ] Add full source/package/SDK provenance to contract diagnostics.
- [x] Invalidate Metro's transform cache when an app's library manifests or
      minimum targets change. The CLI cache already hashed them; Metro's key was
      only the compiler version and host, so editing a manifest served stale
      proxies. Schema, generator and extraction versions still ride on
      `COMPILER_VERSION` alone and need their own fingerprints.
- [ ] Reject incompatible native dependency constraints with provenance.

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
- [ ] Add enumerated lossless numeric conversions in typed IR.
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
- [ ] Add scope-owned operation tracking for arbitrary SDK tasks, and
      SDK-specific cancellation adapters. Child `CancellationSource.scope()`
      propagation is implemented; general task scopes are not.
- [ ] Exercise cancellation during suspension and cancellation/close races
      against actual Expo/Nitro host scheduling.
- [x] Define exactly-once completion under success/cancel races on
      `CancellationSource.finish()`. Close races against SDK cleanup are not
      included.
- [x] Add caller/main/worker/serial-object execution enforcement.
- [ ] Replace registry-wide synchronization around synchronous SDK calls with
      appropriate object/executor serialization; do not hold registry locks while
      invoking arbitrary SDK code or callbacks.
- [x] Implement borrowed reference escape and suspension checks.
- [ ] Implement explicit close: reject new work, cancel/quiesce pending work,
      then run SDK cleanup on the required executor. Use-after-`close` is now a
      compiler error; runtime quiesce and SDK cleanup are not.
- [ ] Define externally owned resource detachment and cleanup-error behavior.

Evidence: `lifetimes.test.ts`, `verify-interop.ts`, async-reference host tests,
`runtime/test/objects.test.ts`, `verify-cancellation.ts`. Arbitrary SDK task
scopes and runtime close quiesce are not implemented.

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
- [ ] Preserve executor and error contracts through indirect calls.
- [ ] Import protocol/interface requirements and validate conformance.
- [ ] Generate concrete Swift conformances and Kotlin implementations.
- [ ] Model owned subscriptions with idempotent, reentrant-safe removal.
- [ ] Retain delegates even where the SDK keeps only weak references.
- [ ] Quiesce in-flight delivery and release captures on teardown.
- [ ] Require explicit error and fallback policies for nonthrowing ABI callbacks.
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
- [ ] Exercise text editing and a parent prop update through UI automation.

## M6 — Composition, lifecycle, and references

- [x] Add typed child slots. A component may declare one `children: NativeView`
      prop that receives its JSX children; several children group vertically.
      SwiftUI passes an `AnyView`, Compose a `@Composable () -> Unit`. A
      component with a slot is Lucent-only and gets no React component or
      declaration, since React owns a host view's children.
- [ ] Define identity by parent, declaration, explicit key, and component type.
- [x] Add keyed eager collections with duplicate-key diagnostics. `For` takes an
      optional `key` closure from the row value to a string; SwiftUI uses
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

- [ ] Add Swift symbol graph and selected Clang/Objective-C extraction adapters.
- [ ] Add JVM annotation/class-signature and Kotlin metadata extraction.
- [ ] Add curated ownership/executor/availability/callback overlays.
- [ ] Support enums, option sets, concrete generics, and inherited members.
- [ ] Emit machine-readable coverage reports for unsupported declarations.
- [ ] Pin toolchain/schema/overlay versions and fingerprint extraction inputs.
- [ ] Generate declarations, compiler metadata, and native manifests together.
- [ ] Extract and execute an overload and protocol/interface from representative
      Apple and Android/Kotlin SDKs.

## M8 — Camera acceptance feature

- [ ] Create the camera package through public package APIs; no compiler camera tag.
- [ ] Implement Expo/Nitro-aware permission adapters, denial, retry, and recovery.
- [ ] Implement native preview and typed session start/stop/interruption/close.
- [ ] Declare borrowed frame planes, format, stride, orientation, and validity.
- [ ] Compile a luminance processor from `.lucent.ts` with known-frame tests.
- [ ] Enforce scoped processing and explicit copying before asynchronous escape.
- [ ] Bound work to one frame in flight with keep-latest backpressure.
- [ ] Close Android frames on success, error, and cancellation.
- [ ] Deliver compact typed results with a configurable notification-rate limit.
- [ ] Author state, event handlers, and feature orchestration in `.lucent.tsx`.
- [ ] Test 1,000 synthetic frames and 100 mount/unmount cycles with zero remaining
      leases, subscriptions, or frames after quiescence.
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
- [ ] Add TSX/UI-toolchain fixture verification and interaction automation.
- [ ] Add a deterministic concurrency/delegate harness and physical-device suite.
- [ ] Test manifest upgrades, stale generated artifacts, and cache invalidation.
- [ ] Keep language, IR, implementation checklist, and website support claims
      aligned with verified behavior.
- [ ] Complete every milestone gate before advertising the roadmap as finished.

## Next execution order

1. Add resource scopes, cancellation, and executor enforcement, including
   deterministic suspended-work and close/cancel races on both hosts.
2. Complete closure environments and delegate subscriptions on those lifetimes.
3. Implement component state, then keys/effects/resource slots.
4. Extend SDK extraction while building the camera through curated public APIs.
5. Complete the camera host/device matrix and migration checks.

## Latest verification checkpoint

- Unit suite after the lifetime slice: 434 passing tests across 49 files.
  Lint passed. Cancellation and interop native checks passed. The four app
  builds below were not rerun for this slice.
- Previous full checkpoint: 429 passing tests across 48 files.
- Root and both example app TypeScript checks: passing.
- Full `pnpm verify`, package build, and website build: passing.
- Swift/Kotlin fixture compilation, extracted SDK execution, and interop
  execution: passing. Both runtimes report zero remaining leases after stress.
- Expo and Nitro Android module compilation: passing.
- Expo and Nitro iOS app builds and simulator checks: passing (`ALL OK`).
- Expo and Nitro Android app builds and emulator checks: passing (`ALL OK`).
  Expo's initial full build selected an older Node 21 daemon. Running with
  Node 24 and `--no-daemon` resolved that environment issue without a source
  workaround or a global toolchain change.

These results cover the implemented subset. They do not close the outstanding
scoped cancellation, delegates, state, lifecycle, extraction, or camera gates.

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

# Lucent tasks

The open work and its acceptance criteria, task by task, grouped by the
gate each task closes. [ROADMAP.md](../ROADMAP.md) says why and in what
order; [decisions/](decisions/) records each decision; finished work is in
[CHANGELOG.md](../packages/lucent/CHANGELOG.md), by release.

Tasks live here, in the repository, rather than in GitHub issues, so an
agent's commit updates the task it works on. A commit that finishes,
changes or adds a task updates its entry here in the same commit: its
status line, its checklist and the table below. A new task takes the next
free id (`TA37` next) and never reuses one.

## Status

| Task          | Title                                                             | State                                                                                                                             |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **G1**        | **Automatic binding ready**                                       |                                                                                                                                   |
| [T28](#t28)   | Prove automatic binding with unknown fixture libraries            | done (#68, 2026-10-04)                                                                                                            |
| **G3**        | **Wrapper preview ready**                                         |                                                                                                                                   |
| [T48](#t48)   | Derive general SDK-view JSX rules and diagnostics                 | done (#75, 2026-10-04)                                                                                                            |
| [T49](#t49)   | Add conditional and keyed-list reactive lowering                  | done (#88, 2026-10-05)                                                                                                            |
| [T50](#t50)   | Integrate Yoga with explicit layout-owner boundaries              | done (#97, 2026-10-05)                                                                                                            |
| [T51](#t51)   | Implement the small Lucent UI library and examples                | blocked: a scope decision (it conflicts with the decision against a cross-platform view vocabulary); needs T49 (done), T50 (done) |
| [T52](#t52)   | Complete useful wrapper ports and certify a preview               | ready (needs the maintainer: devices); needs nothing open                                                                         |
| [TA25](#ta25) | Fix the bare app's FlatList crash from a second react-native copy | done (#76, 2026-10-04)                                                                                                            |
| [TA26](#ta26) | Lay out the slot after a native-only move on iOS                  | done (#77, 2026-10-04)                                                                                                            |
| [TA36](#ta36) | Close the gaps four reference ports need                          | done (#128, #129, 2026-10-07)                                                                                                     |
| **G4**        | **Production candidate**                                          |                                                                                                                                   |
| [T54](#t54)   | Implement measured compiler and runtime optimizations             | done (#90, #92, #93, #100, 2026-10-06)                                                                                            |
| [T55](#t55)   | Implement native recycled and virtualized lists                   | waiting (needs the maintainer); needs T52                                                                                         |
| [T56](#t56)   | Add native gestures and frame-driven animation facilities         | waiting (needs the maintainer); needs T51, T52                                                                                    |
| [T59](#t59)   | Prove media pipelines, high-rate streams and callback executors   | waiting (needs the maintainer); needs T52                                                                                         |
| [T60](#t60)   | Implement headless, background and additional native targets      | ready (needs the maintainer); needs nothing open                                                                                  |
| [T61](#t61)   | Finish the editor, doctor, SDK and debugging workflows            | done (#98, #99, #102, #103, #104, 2026-10-06)                                                                                     |
| [T62](#t62)   | Run the distribution and supported-version compatibility matrix   | waiting; needs T52, T60                                                                                                           |
| [T63](#t63)   | Run the final no-catalog audit, including views and extensions    | ready: T28, T48 and T50 are done; needs nothing open                                                                              |
| [T64](#t64)   | Run lifetime, concurrency and Fabric stress validation            | waiting (needs the maintainer); needs T55, T59, T60                                                                               |
| [T65](#t65)   | Enforce physical-device performance budgets                       | waiting (needs the maintainer); needs T55, T56, T59, T64                                                                          |
| [T66](#t66)   | Complete user documentation and migration examples                | waiting; needs T51, T52, T60                                                                                                      |
| [TA30](#ta30) | Bind Kotlin function types and callback properties                | done (#78, 2026-10-04)                                                                                                            |
| [TA31](#ta31) | Finish the Kotlin shim shapes                                     | done (#79, 2026-10-04)                                                                                                            |
| [TA32](#ta32) | Read Swift packages and the iOS target from the project           | done (#82, 2026-10-04)                                                                                                            |
| [TA33](#ta33) | Bind the remaining Swift shapes                                   | done (#83, 2026-10-05)                                                                                                            |
| [TA34](#ta34) | Turn a Java Throwable into a Lucent Error                         | done (#80, 2026-10-04)                                                                                                            |
| [TA35](#ta35) | Bind a package's own pods in an Expo app                          | ready; needs nothing open                                                                                                         |
| [T67](#t67)   | Pass the integrated production-candidate gate                     | waiting (needs the maintainer); needs T62, T63, T64, T65, T66                                                                     |
| **G5**        | **Production recommendation**                                     |                                                                                                                                   |
| [T68](#t68)   | Prepare independent author and app pilot packages                 | waiting (needs the maintainer: pilots); needs T67                                                                                 |
| [T69](#t69)   | Collect real pilot evidence and close the resulting defects       | waiting (needs the maintainer: pilots); needs T68                                                                                 |
| [T70](#t70)   | Produce the final capability and readiness assessment             | waiting; needs T69                                                                                                                |

## Requirements

These hold for every task. A task is not done by weakening one of them.

| Requirement                  | What it means                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No curated catalog           | APIs come from installed SDKs and resolved dependencies. No SDK, API or view catalog, central per-library override database or class-name allowlist. General ABI rules and the small platform integration surface (JSI, Fabric, view identity, JNI/ARC, app lifecycle) are allowed. Package-authored adapters are explicit and never become core registry entries. Test inventories are never allowlists. |
| JavaScript semantics         | The TypeScript-first authoring model and the semantics in [docs/semantics.md](semantics.md) are the contract. Unsupported syntax or types fail with an actionable `LUCENT` diagnostic, never with invalid native code.                                                                                                                                                                                    |
| Accepted toolchain decisions | Generated Swift and Kotlin shims are part of the design. Swift values cross as boxed references, Kotlin extension functions are receiver-first functions, and no Xcode or Swift minimum goes beyond React Native's.                                                                                                                                                                                       |
| Thread ownership             | JSI values stay on their runtime's JS thread; other threads hold `Host` ids. No raw JSI value in UI or worker state.                                                                                                                                                                                                                                                                                      |
| UI isolation                 | New UI execution never waits behind module computation. Views are not built on the legacy global lock with a promise to fix it later.                                                                                                                                                                                                                                                                     |
| Copy by default              | Arrays, objects and bytes keep their copy semantics. Fast buffers need explicit ownership; no implicit concurrent shared mutation.                                                                                                                                                                                                                                                                        |
| Generated code               | Everything is generated through `packages/codegen`. Every C++ build passes `-ffp-contract=off`. Evaluation order is explicit, coroutine frames own their captures and arguments, and JSI objects stay on the JS thread.                                                                                                                                                                                   |
| Repository rules             | [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md): differential e2e cases, runtime sanitizers, synchronized examples, changesets for user-visible changes, docs updated with behavior.                                                                                                                                                                                                  |
| Contracts first              | Shared interfaces are frozen as [contracts](design/contracts.md) before several parts implement them. The product direction and acceptance gates change only by an explicit, recorded decision.                                                                                                                                                                                                           |
| Honest evidence              | Written code, host tests, simulator or emulator runs, physical-device runs and external use are different evidence levels. A missing device or toolchain is a blocked check, never a pass.                                                                                                                                                                                                                |

## How to read a task

Each task has a stable anchor (`docs/tasks.md#t28`) that commits, PRs and
other docs link to, a one-sentence goal, then:

- **Status:** one of `ready` (every dependency is done), `waiting` (on
  the tasks in Needs), `blocked` (on a decision or the maintainer),
  `in progress` (a branch exists), `in review` (a PR is open) or
  `done (date)`, with the PR that merged it and the release that
  shipped it.
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

T28 merged as #68 on 2026-10-04, which closed this gate.

<a id="t28"></a>

### T28: Prove automatic binding with unknown fixture libraries

**Goal:** Show that a native library Lucent has never seen binds and runs
end to end by rule, with no change to Lucent.

- **Status:** done (2026-10-04): merged as #68, released in 0.1.3.
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
- New gaps, all closed since (TA30 and TA33 are done): a Kotlin function
  type is bound as the `Function1` class; a property of an interface type takes no Lucent function, and a view may
  not give it an object either, so a view cannot set one (both
  [TA30](#ta30)); a class whose superclass's module is only named gets a
  misleading error for its inherited initializers ([TA33](#ta33)).

- The fixture, from the design's acceptance scenario: a random namespace, a
  class hierarchy, a callback interface, a generic wrapper, a view subclass
  and a native async method. Change its version and add or remove a used
  method; check cache invalidation, stable unaffected names and an
  actionable missing-member diagnostic. Execute at least one call, one
  callback and one view.
- Known gaps, turned into tasks that are all done (2026-10-04 to 2026-10-05;
  each task's entry says what it closed). From T26 ([TA31](#ta31)): Kotlin
  shims refuse generic members, Lucent functions passed as `suspend`
  functions, assigning value classes, and implementing such members; defaults
  are not optional for generic members. From T11 ([TA32](#ta32)): Swift
  Package Manager modules are not discovered (packages can declare and link
  them), the iOS target used for extraction is fixed rather than read from the
  project, and `use_frameworks!` with dynamic linkage is not built
  ([T62](#t62)). From T25 ([TA34](#ta34)): a `lucent:android` helper turning a
  `Throwable` into the `Error` a thrown one becomes would let adapters keep
  the error's `code`. From the improvement plan (2026-09-23, not rechecked
  since, [TA33](#ta33)): factory initializers that Swift imports as `init` are
  dropped by the extractor, and functions Swift imports as members of
  CoreFoundation-style handles (`cgImage.width`) are not bound.

<a id="g3-wrapper-preview-ready"></a>

## G3: Wrapper preview ready

Native views become a usable, validated preview: JSX for any representable
SDK view, keyed lists, Yoga layout, a small UI library and real wrapper
ports beside their reference libraries. The gate closes with T52, which
certifies the preview's exact support matrix.

G2 (the Fabric and isolation spike, T44) passed on 2026-09-26, and the view
wave that followed shipped SwiftUI and Compose hosts. The internal
`LUCENT_VIEWS=fabric` switch was removed on 2026-10-07: every build
generates views. This gate certifies them as a preview. T48, T49, T50,
TA25, TA26 and TA36 are done; T52 is ready and needs devices, and T51
needs a scope decision.

<a id="t48"></a>

### T48: Derive general SDK-view JSX rules and diagnostics

**Goal:** Let JSX create and update any representable SDK view from its
native declarations, with no per-view entry in Lucent.

- **Status:** done (2026-10-04): merged as #75, released in 0.1.3.
- **Area:** Views and compiler.
- **Needs:** T13 (done), T36 (done), T43 (done), T44 (done).
- **Verify:** V1, V2, V4.
- **Where:** `packages/compiler/src/sdk/view-rules.ts` (the rules, under
  `sdk/` so the declaration cache follows them), `sdk/dts.ts` and
  `sdk/native-jsx-dts.ts` (typing), `emit/native-jsx.ts` (lowering),
  `ui/view-coverage.ts`; [views.md](design/views.md#platform-views-as-jsx).

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
  design](design/native-platform.md#165-derive-syntax-make-native-behavior-explicit).
  Its child adapters were replaced by derived children (decisions log,
  2026-10-04).
- Evidence: `test/view-rules.test.ts`, `test/ui/native-jsx-types.test.ts`,
  `test/ui/native-jsx-run.test.ts` (Catalyst), `test/ui/native-jsx-android.test.ts`,
  `test/ui/native-jsx-diagnostics.test.ts`, `test/unknown-library.test.ts`.
  Android views mount only on Android; their glue is compiled against
  jni.h.
- Native JSX may be returned from any of setup's own code, a one-file
  component's PLATFORM branches included, and its slot made in one
  (decisions log, 2026-10-06); an iOS attribute is checked against the
  oldest iOS, as an assignment in setup code is (LUCENT3007).
- The app imports a component's React types as `lucent:views/<module>`,
  which TypeScript and Metro both resolve (decisions log, 2026-10-06).

<a id="t49"></a>

### T49: Add conditional and keyed-list reactive lowering

**Goal:** Make conditional and keyed-list UI update only what changed,
keeping each item's identity and lifetime.

- **Status:** done (2026-10-05): merged as #88, released in 0.2.0.
- **Area:** Views and compiler.
- **Needs:** T42 (done), [T48](#t48) (done).
- **Verify:** V1, V2, V3.
- **Where:** `packages/runtime/cpp/lucent/ui_children.h` (the keyed
  reconciler and branches) and `test/ui_children_test.cpp` (the reference
  backend); `packages/compiler/src/emit/native-jsx.ts` (lowering) and
  `sdk/view-rules.ts` (remove and move by rule);
  [views.md](design/views.md#platform-views-as-jsx).

- [x] Implement conditional insertion and removal, and keyed item scopes
      with reactive item replacement for a preserved key: native view JSX
      takes `{cond && <X />}`, `{c ? <X /> : <Y />}` and
      `{items.map((item) => <X key={item.id} />)}`, mounted on Mac Catalyst
      (`native-jsx-flow-run.test.ts`) and compiled for Android against
      jni.h.
- [x] Define duplicate keys, array identity and mutation notification,
      nested scopes, cleanup, and stable component state across reorders
      (views.md, "Children that come and go"): arrays and items are
      values; a duplicate or NaN key throws and keeps the children; each
      item and branch is a scope of its own, ended once.
- [x] Verify that `[a,b,c] → [c,a,b]` causes no create or delete and one
      indexed move on the test backend, and that a title change affects only
      the retained item's binding; on Catalyst, the kept labels are the
      same views.
- [x] Add reorder, delete and reinsert stress tests with active tasks and
      listeners (500 random rounds, plain and sanitized); measure before
      adding more elaborate move-minimizing algorithms.

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

- **Status:** done (2026-10-05): merged as #97, released in 0.2.0.
- **Area:** Views.
- **Needs:** T46 (done), T47 (done), [T48](#t48) (done).
- **Verify:** V1, V4, V5, V8.
- **Where:** `packages/runtime/cpp/lucent/layout.h` (the core) and
  `ui_flex.h`, `platform/ios_layout.mm`, `platform/android_layout.cpp`
  with `LucentFlexView.java` (the adapters); `lib/sdk/ui.d.ts` (`Flex`,
  `LayoutStyle`) and `emit/native-jsx.ts` (lowering);
  [views.md](design/views.md#platform-views-as-jsx).
- **Needs the maintainer:** physical devices (V8).

- [x] Use React Native's Yoga dependency, and avoid a second, conflicting
      Yoga ABI: `layout.h` includes React Native's `<yoga/Yoga.h>` (the
      app's pod and prefab); the runtime tests build its sources.
- [x] Keep outer Fabric layout, the Lucent Yoga subtree and native-container
      child layout separate; a width prop must not silently switch the
      ownership mode: the `Flex` tag decides (decisions log, 2026-10-05).
- [x] Implement layout and measure invalidation and frames through the
      approved adapters, including native content changes and constraints:
      Yoga's dirty marks, the mount's `Content` listeners, leaves measured
      by `sizeThatFits:`, Auto Layout or `View.measure`.
- [x] Test nested native and Lucent containers, margins, padding and gaps,
      RTL and density, and confirm that only one owner writes each child's
      frame: `layout_test.cpp` and the Catalyst mount
      (`native-jsx-layout-run.test.ts`); Android compile-checked.

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

- **Status:** blocked (2026-10-08): its dependencies are done, but as written it
  conflicts with the decision against a cross-platform view vocabulary
  ([0012](decisions/0012-jsx-for-swiftui-and-compose-with-no-wrappers.md)); it
  needs a scope decision first.
- **Area:** Views.
- **Needs:** T45 (done), [T49](#t49) (done), [T50](#t50) (done).
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

- **Status:** ready; needs the maintainer for device runs.
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

- The views switch is gone (2026-10-07); the preview is where the
  maintainer decides what is documented for users as supported. TA25 and
  TA26 should land first.

<a id="ta25"></a>

### TA25: Fix the bare app's FlatList crash from a second react-native copy

**Goal:** Make a FlatList work as a React child in the bare example app,
where it crashes today.

- **Status:** done (2026-10-04): merged as #76, unreleased (examples only).
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

- **Status:** done (2026-10-04): merged as #77, unreleased.
- **Area:** Views (iOS host).
- **Needs:** none.
- **Verify:** V1, V5.
- **Where:** The iOS host's slot layout (`HostSlot`) and the `ui::Content`
  callback.

- [x] Mark the slot for layout from the `ui::Content` callback that T46
      added (it owns the sizing callback today; pass a second callback).
      `HostSizing::start` takes a callback run after each content change is
      measured; the iOS host's marks the slot for layout.
- [x] Reset `HostSlot`'s bound when the slot moves. The same callback calls
      `contentChanged()`, so the slot reports again past the bound.
- [x] Test a slot moved by a timer or an animation on the iOS simulator: the
      children follow without waiting for the next host layout. The slots
      spike's Card moves its slot from a native timer (`driftLater`); its
      "timer move" check failed on the simulator before (children at x 74
      natively, 58 in React) and passes after, 17 checks of 17, twice. The
      Android emulator passes it with no change: its host already followed.

**Done when:** a native-only slot move on iOS repositions the children
without an unrelated layout pass.

**Notes:**

- Found by T47b, which documented it as a limitation. A similar wait applies
  inside a hosting controller between commits.

<a id="ta36"></a>

### TA36: Close the gaps four reference ports need

**Goal:** Let react-native-mmkv, expo-file-system, expo-image and
expo-video be ported with their React-facing APIs kept, to prove a
native module and a native view each.

- **Status:** done (2026-10-07): merged as #128, #129, unreleased.
- **Area:** Compiler, runtime, views.
- **Needs:** none.
- **Verify:** V1, V3, V5.
- **Where:** `types.ts` (`gathersRest`), `emit/bindings.ts`,
  `runtime/cpp/lucent/bytes.h` (`ArrayBuffer`),
  `analysis/main-state.ts`, `emit/index.ts` (`mainInitialization`).

- [x] Probe each library's API shape against main: rest parameters
      (`new File(dir, "a.txt")`), `ArrayBuffer` (MMKV's values), and a
      class's native object reaching a view (expo-video) were refused;
      a constructor taking a union no other export used did not build.
- [x] Convert the types only constructors take at the boundary
      (`classes` case).
- [x] Rest parameters on functions, methods and constructors, from
      JavaScript and Lucent, spreads of any iterable included
      (`rest-parameters` case); refused as values and in function types.
- [x] `ArrayBuffer`: views sharing it, `slice`, ToIndex checks, the
      boundary (a copy), unions and compute tasks, in the runtime and the
      JavaScript `lucent:core` (`array-buffers` case).
- [x] Main-thread state: a variable only main-thread code uses is read
      and written by views without the lock, and assigned on the main
      thread on reload (`main-state.test.ts`).
- [x] The players spike (`--entry players.js`) on the iOS simulator
      (iPhone 17 Pro, Release): each view shows the native label its
      player keeps, the first renamed through `main()` two seconds in
      without a render; a rest parameter and ArrayBuffers cross the app's
      JSI (`joined("a","b","c")`, checksum 38037, a 3-byte ArrayBuffer
      back). Android is not run.

- [x] Fix what porting the four met (the ports themselves stay local
      until views ship): Objective-C initializers and overloads
      TypeScript could not tell apart are static methods named by their
      Swift labels or selectors (`new NSURL(text)` made a file URL);
      Swift async results that are tuples (a compiler crash); iOS
      `instanceof`; Foundation objects passed to Swift as the value types
      they bridge to; accessors and methods through a union of classes;
      namespace imports of Lucent modules; `null` for an optional
      Objective-C block; `flatMap` callbacks giving values as well as
      arrays, and `never[]` for an empty literal; main-thread state in
      callbacks a component gives the platform.

**Done when:** the four ports compile against a release with these, each
keeping its React-facing API behind a thin JavaScript wrapper where the
original has one.

**Notes:**

- The four ports' sources are not in the repository (2026-10-08): only
  the players spike (`apps/bare-example/.views-spike/players.lucent.tsx`)
  is. Now that views build everywhere
  ([0047](decisions/0047-views-without-a-switch.md)), publishing them
  under `examples/`, as `lucent-camera` and the others are, needs the
  maintainer's local sources.
- Not needed: class instances as view props (Expo's `VideoView` passes
  its player's shared-object id, and so can a port), mixed unions in
  view props (Expo's JavaScript normalizes `source` before native), and
  records in view props (expo-image's `headers` can cross as pairs).
- MMKV through its pod and Gradle library binds today; whether it keeps
  Nitro's speed on Android (JNI against Nitro's direct C++) is for T54's
  measurements.

<a id="g4-production-candidate"></a>

## G4: Production candidate

Lucent is technically validated and ready for pilots: the semantic IR
migration and measured optimizations, the demanding capabilities (native
lists, gestures, media, background targets), the distribution matrix, the
no-catalog audit, stress tests, physical-device budgets, complete docs and a
green CI. The gate closes with T67.

T54, T61 and T28's binding follow-ups (TA30 to TA34) are done. T60, T63
and TA35 are ready; the rest follow G3's work.
Several tasks need physical devices, which only the maintainer can run.

<a id="t54"></a>

### T54: Implement measured compiler and runtime optimizations

**Goal:** Make generated code faster where profiles show it matters, without
changing JavaScript semantics.

- **Status:** done (2026-10-06): merged as #90, #92, #93, #100, released in 0.2.0.
- **Area:** Compiler, with runtime and verification review.
- **Needs:** T10 (done), T30 (done), T32 (done), T53 (done).
- **Verify:** V1, V2, V3, V7.
- **Where:** `emit/integers.ts` (range analysis), `ir/cpp.ts` (int64
  writes, direct callbacks), `ir/verify.ts`, the runtime's `jsstring`,
  `array.h`, `number.h` and `core.h`.

- [x] Profile first: the kernels sampled natively (`sample` on macOS)
      showed string allocation and 32-byte `String` moves (`strings`,
      `wordCount`), a data-dependent branch in `toInt32` (`crc32`), a
      double remainder chain (`xorshift`) and a `std::function` comparator
      (`sortNumbers`). Implemented, in that order of gain: allocation
      reduction (one allocation per string, none up to 15 Latin-1 units;
      `join` sized up front), representation propagation (a range analysis
      keeps bounded arithmetic in int64), devirtualization (an arrow passed
      straight to a runtime method is the lambda itself), conversion
      elimination (one-branch `toInt32`, integer `numberToString` with
      `to_chars`). Specialization, object escape analysis, retain/release
      removal and bounds-check elimination did not show in the profiles:
      for-of copies a string handle per element (free for inline strings),
      and removing `crc32`'s bounds check needs the table's length, which
      flow-insensitive analysis cannot prove.
- [x] For each pass, add a must-optimize fixture, a similar
      must-not-optimize fixture, verifier coverage, and a comparison of
      baseline and optimized observable results:
      `test/ir/optimizations.test.ts` (which locals become int64 and which
      stay double, which callbacks are lambdas), `e2e/cases/optimizations`
      (the same functions against JavaScript: -0, NaN, 2^53, ToInt32 edges,
      inline and heap and two-byte strings as `Map` keys, callbacks that
      mutate or throw), the verifier's integer-register rule, and the
      runtime's `stringStorage` and `indexes` checks.
- [x] Preserve JavaScript numbers, UTF-16, order, errors and identity, and
      keep floating-point contraction off; never use fast-math to win a
      benchmark. Arithmetic is an int64 only where every value is an exact
      integer within ±2^53 that is never -0; a callback is a lambda only
      where nothing else sees the function value; `-ffp-contract=off`
      throughout. The e2e suite, the runtime tests and ASan, UBSan and TSan
      pass.
- [x] Report runtime gain, allocation and copy effects, native code size and
      build time; cap specialization growth and keep checks where the proof
      is insufficient. Host Hermes on an M5 Pro, speedup against JavaScript,
      main → branch: `crc32` 3.4x → 5.9x, `xorshift` 7.8x → 22.8x,
      `wordCount` 2.9x → 4.5x, `strings` 2.4x → 4.4x, `sortNumbers` 10x →
      14.2x, `murmur` 15.8x → 20.8x, the rest unchanged; `strings1000` 1.25x →
      1.18x a C++ TurboModule's call, `structsOut1000` 2.79x → 2.73x (budget
      2.75x). A long string is one allocation instead of two, a short one
      none; `join` allocates once. Generated objects of five e2e modules 633
      KB → 456 KB (fewer `lucent::Fn` wrappers), runtime objects 997 KB →
      986 KB, serial compile time unchanged (4.0 s and 11 s). No
      specialization was added, so there is no growth to cap; bounds checks
      stay.
- [x] Carried over from the earlier TODO: find why `sieve` is about 21x
      faster than JavaScript on macOS but about 4.8x on the Linux CI runner
      (clang and libstdc++). On baseline x86-64 (no SSE4.1, as CI builds)
      `std::trunc` is a call into libm, made for every `composite[j] = true`
      with a double index; and libstdc++ against libc++ costs it more again.
      Measured in an x86-64 container (emulated, so relative only): `sieve`
      11.5 ms on main, 7.9 ms with the index check that converts to an
      integer and back there (`indexBelow`); on ARM, `frintz` is one
      instruction, so the check keeps it.
- [x] Carried over from the earlier TODO: one allocation per string (units
      inline with the header). The reference count stays atomic (decision
      of 2026-10-05).

**Done when:** improvements are measured, semantics-preserving and within
the runtime, size and build budgets, rather than only producing shorter C++.

**Notes:**

- Against handwritten C++ (the same kernels, written natively, on the same
  host): `fnv1a`, `xorshift`, `mandelbrot`, `sortNumbers`, `wordCount` and
  `strings` are within 20% or faster; `murmur`, `crc32` and `sieve` are
  about 2x, held back by a per-character `+=`, a `number[]` table of doubles
  with its bounds check, and a double loop index. Those are the next
  candidates: element representation for local arrays, and counters bounded
  by their loop's condition.
- T10's host tooling is done; its physical-device baselines are deferred to
  the maintainer and belong to T65. Boundary budgets have thin margins:
  `structsOut1000` measured 2.56–2.79x against 2.75x on the development
  machine, and `structsIn1000` 1.63–1.67x on the CI runner, now against
  1.75x (decision of 2026-10-03). Design reference: section 13.4.

<a id="t55"></a>

### T55: Implement native recycled and virtualized lists

**Goal:** Render long lists natively with viewport-driven cells, recycling
and stable item identity.

- **Status:** waiting on the open tasks in Needs.
- **Area:** Views, with the platform hosts.
- **Needs:** [T49](#t49) (done), [T50](#t50) (done), [T52](#t52) (open).
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

- **Status:** waiting on the open tasks in Needs.
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

- **Status:** waiting on the open tasks in Needs.
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

- **Status:** ready; needs the maintainer for device runs.
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

- **Status:** done (2026-10-06): merged as #98, #99, #102, #103, #104, released in 0.2.0.
- **Area:** Tooling.
- **Needs:** T23 (done), T24 (done), T40 (done), T41 (done), [T48](#t48)
  (done).
- **Verify:** V1, V6, V9.
- **Where:** CLI and editor integration, JSON schemas, tree and ownership
  debugging output.

- [x] Add navigation to a declaration's origin, availability and ownership
      diagnostics, quick fixes, SDK mapping explanations and used-symbol
      upgrade reports: every SDK declaration's doc names what it calls
      natively and how its mapping differs (hover, go-to-definition,
      `sdk show`); diagnostics carry quick fixes where the fix is exact,
      which the ts-plugin offers; availability (LUCENT3007) and ownership
      (LUCENT3030, 3031) diagnostics and `lucent sdk diff`'s used-symbol
      report already existed.
- [x] Have `doctor` read the shared build and artifact identities, and
      explain dependency conflicts, cache misses, missing targets and stale
      installations: `last-build`, `cache` (against the record before,
      which the build keeps), `native-targets` and `native-build` (the
      newest Xcode or Gradle build read for the identity Lucent compiles
      in, judged as the app judges it).
- [x] Show view trees, effect updates, source-mapped native failures, copy
      and queue traces and owned resources, without exposing implementation
      noise in ordinary application UI: effect runs are trace spans at their
      `.lucent.ts` line (`lucent trace` lists the bindings that took the
      most), and a debug build's `__lucentDebug.snapshot()` gives the live
      counts of what the runtime owns and each mount's native view tree;
      copy and queue traces and `#line`-mapped failures already existed.
- [x] Validate TTY, non-TTY and JSON output, `init`, new module and new
      view, transitive workspace edits, cold failures and recovery; measure
      the warm feedback targets: `output-matrix.test.ts` runs every command
      (one schema-valid JSON document or a refusal; no escape codes outside
      a terminal; the terminal's own output stays covered by the Ink tests),
      `lucent new view`,
      `workspace-build.test.ts`, and `scripts/bench-build.ts --check`
      (p95 against `bench-build-budgets.json`; 2026-10-06 on 53 modules:
      diagnostics 486 ms, check 941 ms, build 959 ms, all within budget;
      close enough to their budgets that it is no CI gate on shared runners).
- [x] Carried over from T41: check that view loading runs the same
      stale-native identity check as modules (T41 left views to the view
      work), or add it: it does (a view-only module's proxy checks before
      it makes a component; its props, events and commands are in its API
      hash), proven by `view-identity.test.ts`.
- [x] Carried over from the full SDK plan: run `lucent sdk coverage --all`
      in CI and show the top 20 skip reasons in the job summary (CI checks
      five iOS modules and `android.*` today): `--all` and `--summary`; 526
      modules locally, 53 unreadable for the simulator and listed.

**Done when:** a developer can build and diagnose a module or view through
one coherent workflow, and machine-readable consumers share its schema.

**Notes:**

- Design reference: sections 17.3–17.5.

<a id="t62"></a>

### T62: Run the distribution and supported-version compatibility matrix

**Goal:** Prove that installing and upgrading Lucent packages works on a
stated range of React Native and Expo versions.

- **Status:** waiting on the open tasks in Needs.
- **Area:** Verification and tooling.
- **Needs:** T17 (done), T27 (done), T33 (done), [T52](#t52) (open),
  [T60](#t60) (open), [T61](#t61) (done).
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

- **Status:** ready: T28, T48 and T50 are done.
- **Area:** Verification, with bindings and views review.
- **Needs:** [T28](#t28) (done), [T48](#t48) (done), [T50](#t50) (done), T57
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

- **Status:** waiting on the open tasks in Needs.
- **Area:** Verification and runtime.
- **Needs:** T21 (done), T30 (done), T32 (done), T45 (done), [T49](#t49)
  (done), [T55](#t55) (open), [T59](#t59) (open), [T60](#t60) (open).
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

- **Status:** waiting on the open tasks in Needs.
- **Area:** Verification.
- **Needs:** T10 (done), T40 (done), [T54](#t54) (done), [T55](#t55) (open),
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

- The budgets are listed under [Validation](../ROADMAP.md#performance-budgets).

<a id="t66"></a>

### T66: Complete user documentation and migration examples

**Goal:** Make the public docs enough for independent use, and make them
match shipped behavior.

- **Status:** waiting on the open tasks in Needs.
- **Area:** Tooling and verification, with each area's authors.
- **Needs:** T25 (done), T27 (done), [T51](#t51) (open), [T52](#t52) (open),
  T57 (done), T58 (done), [T60](#t60) (open), [T61](#t61) (done).
- **Verify:** V1, V9.
- **Where:** Public guides, reference and examples, coordinated with ongoing
  docs.

- [ ] Finish module and view guides, setup-once reactivity, ownership and
      threading, buffers, SDK discovery, adapters, native configuration and
      troubleshooting (the docs restructure of 2026-10-04: Guides, Packages,
      API and Architecture sections).
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
      and a run of the Get started guides on the iOS simulator and the
      Android emulator.

**Done when:** the docs support independent use and match shipped behavior.
This final sweep does not excuse delaying docs for earlier completed tasks.

<a id="ta30"></a>

### TA30: Bind Kotlin function types and callback properties

**Goal:** Let Lucent functions be Kotlin function types and fill
callback properties, which T28's unknown Android view could not.

- **Status:** done (2026-10-04): merged as #78, released in 0.1.3.
- **Area:** Bindings, Android host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** Kotlin metadata to schema types, Android declarations and
  JNI glue (`NativeProxy` for `kotlin.jvm.functions`), the view rules.

- [x] Bind a Kotlin function type (`(Double) -> Unit`, nullable or not) as
      a TypeScript function type both ways: a Lucent function passed or
      assigned becomes a `FunctionN` proxy, and a Kotlin one returned is
      callable. The extraction types it as the function it declares
      (`kotlin-extraction.test.ts`); JNI plans take it, refusing a
      function of functions.
- [x] Let a property of a single-method interface type take a Lucent
      function, as a method parameter of that type does: on Android a
      property's write type is its own (a get and a set accessor), and
      an assignment converts the value as an argument is.
- [x] Let a view set such a property with a function (its call runs on the
      main thread), instead of refusing every way to set it (LUCENT3021):
      in setup code, and as a JSX attribute (the view rules take both
      properties).
- [x] Extend T28's unknown library: its Kotlin gauge takes a function
      property, a fun interface property, a function argument, and returns
      a Kotlin function, run on the desktop JNI host
      (`unknown-library.test.ts`, its output `3 -3 3.5 -3.5 | 4.5 7`); its
      Android dial sets both kinds of property in setup and as JSX, whose
      glue compiles against jni.h.

**Done when:** the idiomatic Kotlin callback shapes bind by rule, in
module code and in views.

**Notes:**

- Found by T28: `var onTurn: ((Double) -> Unit)?` is typed as the class
  `Function1<number, Unit>`; a `fun interface` property rejects a function
  (TS2322), and a view refuses an object implementing it.

<a id="ta31"></a>

### TA31: Finish the Kotlin shim shapes

**Goal:** Call the Kotlin members T26's shims refuse.

- **Status:** done (2026-10-04): merged as #79, released in 0.1.3.
- **Area:** Bindings, Android host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** `packages/compiler/src/emit/kotlin.ts`, the shim plans.

- [x] Generic members (functions and properties of a type parameter).
      Unbounded ones went through shims already (T26's flows); a bounded
      one's shim is generic itself, declaring the bounds the schema now
      keeps (`kotlin.upperBounds`), for a member's and a class's type
      parameters. A bound with a use-site projection stays refused, named.
- [x] Lucent functions passed as `suspend` functions: already through
      shims (T26: `Ticker.each`, `transformed`, on the JVM).
- [x] Assigning value classes, and implementing members that take them:
      a setter's shim; an interface's value-class member through the
      proxy (`box-impl`, `unbox-impl`), and its suspend member, resumed by
      the promise the Lucent method returns. Overriding a Kotlin class's
      such members stays refused, named. A value class property's
      accessors are now named as Kotlin's (their mangled JVM names made
      the declarations invalid).
- [x] Defaults left out for generic members: through the same generic
      shims.

`kotlin-shims.test.ts` runs each shape through the JNI glue on the
desktop JVM (`7 c x z 20 true q no names`, CheckJNI on); the shims compile
with kotlinc, warnings as errors.

**Done when:** each shape is called through a shim and checked by the
Kotlin shim tests, or refused with a diagnostic naming the member.

<a id="ta32"></a>

### TA32: Read Swift packages and the iOS target from the project

**Goal:** Bind Swift packages an app adds, against the iOS version the app
targets.

- **Status:** done (2026-10-04): merged as #82, released in 0.1.3.
- **Area:** Bindings, Apple host, build.
- **Needs:** none.
- **Verify:** V1, V4, V5.
- **Where:** `packages/bindgen/src/provider.ts` (iOS artifacts), the Xcode
  project reader.

- [x] Discover Swift Package Manager modules the app's Xcode project
      resolves, as pods are, keyed by their resolved versions. The project
      file names the packages it references, Package.resolved their pins;
      Lucent clones each at its revision and builds its library products
      with `xcodebuild` (decided 2026-10-04: Lucent builds them, rather
      than reading Xcode's DerivedData, so they bind before the app's
      first build), cached per revision, target and Xcode. Modules are
      `spm:identity@version`, and LucentNative links the packages the code
      imports at the app's exact version (decided 2026-10-04: LucentNative
      owns the link, the app target does not add the product, since a
      static package linked by both duplicates its symbols).
- [x] Extract against the deployment target the project sets, not a fixed
      one: the app target's `IPHONEOS_DEPLOYMENT_TARGET` (the expo
      example's 16.4) is the extraction target, and the oldest iOS the
      availability checks and the generated pod use (never below 15.1).

`packages/lucent/test/swift-packages.test.ts` adds a package tagged 1.0.0
to an app deployed to iOS 16.4: it binds from `spm:gauges@1.0.0` read for
`arm64-apple-ios16.4-simulator`, its 16.4 API needs no check and its iOS
17 one does (LUCENT3007, "apps run from iOS 16.4"), and LucentNative's
podspec links the package at 1.0.0. The bare example references
KeychainAccess 4.2.2: its SDK probe stores, reads and removes a value
through it.

**Done when:** an app's Swift package binds by rule, and an API newer than
the app's target needs an availability check.

**Notes:** `use_frameworks!` with dynamic linkage is [T62](#t62)'s.

<a id="ta33"></a>

### TA33: Bind the remaining Swift shapes

**Goal:** Bind or precisely refuse the Swift shapes still left out.

- **Status:** done (2026-10-05): merged as #83, released in 0.1.3.
- **Area:** Bindings, Apple host.
- **Needs:** none.
- **Verify:** V1, V4.
- **Where:** `packages/bindgen/src/swift.ts`, `ios.ts`, the Swift shims.

- [x] Tuples, which the extractor skips (now explained when called).
      A Swift tuple is a TypeScript tuple, its labels the elements' names
      (`(min: Int, max: Int)` → `[min: number, max: number]`), crossing a
      shim as an array of its elements' objects, both ways
      (`swift-shapes.test.ts`). Tuples of optional values or C structs are
      refused, named.
- [x] Functions returned by or passed to Swift (LUCENT2002, "fn values
      cannot cross to Swift yet"). A closure crosses a shim as an
      Objective-C block (`@convention(block)`): a Lucent function given,
      escaping or not, is the block the glue makes of it, which Swift
      calls as a closure; a closure Swift returns is cast to a block,
      which Lucent calls. Closures taking or giving other than numbers,
      booleans, strings and Objective-C objects are refused, named.
- [x] Factory initializers Swift imports as `init`, which the extractor
      drops (recheck first: recorded 2026-09-23). Still dropped on
      recheck: `+widgetWithLabel:` is now a constructor sent to the class
      (`[WDGWidget widgetWithLabel:…]`, `factory` in the schema); a
      subclass calling it as `super(…)` is refused, named.
- [x] Members Swift imports onto CoreFoundation-style handles
      (`cgImage.width`; recheck first). Still missing on recheck (CGImage
      declared nothing). The C functions Swift imports as a handle's
      members are read from the module's API notes and headers'
      `swift_name` attributes (CoreGraphics: 566): properties (their
      getter, and setter), methods (the object where the name puts
      `self`), static members and initializers, each a C call; a
      Create/Copy function's result is owned. A failable initializer, or a
      function whose Swift name Lucent does not find, is left out, said why.
- [x] A subclass's initializers inherited from a class whose module is only
      named: today `new Dial(frame)` fails with TS2674 (UIView's
      constructor is protected) until UIKit is imported. Type them, or say
      to import the superclass's module. The error now says so: the dial's
      initializers are UIView's, from lucent:ios/UIKit, which no file
      imports; a bare import declares them (`unknown-library.test.ts`).

**Done when:** each shape binds by rule, or its diagnostic names the member
and what to do.

**Notes:**

- Found after (2026-10-05): a Swift `inout` parameter was bound as a value,
  its shim not compiling (a module's own graph marks it in the
  declaration only); it is skipped, said why. Of an overlay's Swift
  overloads of one name on an Objective-C class, only the first was kept
  (`NSCoder.decodeTopLevelObject(forKey:)`, `RunLoop.schedule(after:…)`
  were dropped unsaid); all are kept, an Objective-C member of that name
  still winning.

<a id="ta34"></a>

### TA34: Turn a Java Throwable into a Lucent Error

**Goal:** Let adapters reject with the `Error` a thrown Java exception
becomes, its `code` kept.

- **Status:** done (2026-10-04): merged as #80, released in 0.1.3.
- **Area:** Runtime, Android host.
- **Needs:** none.
- **Verify:** V1, V3.
- **Where:** `lucent:android`, `packages/runtime/cpp/lucent/platform/android.cpp`
  (`errorOf`).

- [x] Add a `lucent:android` function taking a `Throwable` and returning
      the `Error` Lucent makes of a thrown one (`name`, `message`, `code`
      as the class name): `errorOf(throwable)`. Unlike a rethrow, it
      leaves a Lucent error the exception carries with it, so reading the
      same `Throwable` twice gives the same error.
- [x] Use it in an adapter test where a callback API reports failure with a
      `Throwable`: `android-throwable-error.test.ts`, on the desktop JNI
      host, rejects a `fromCallback` adapter with the error a thrown
      `IllegalStateException` becomes, `code` included, and reads a
      message-less exception's as its class name. A Lucent error thrown to
      Kotlin by a suspend function argument and handed back as the
      `Throwable` Kotlin caught reads as that error itself (`===`, its
      `RangeError` name kept).

**Done when:** an adapter's rejection has the same `code` as a thrown
exception's.

**Notes:** From T25, which removed the named awaitable dispatch.

<a id="ta35"></a>

### TA35: Bind a package's own pods in an Expo app

**Goal:** Let `expo prebuild` and the iOS build that follows it bind a
pod that a Lucent package's own `lucent.json` declares, without a manual
step.

- **Status:** ready.
- **Area:** Tooling, Apple host.
- **Needs:** none.
- **Verify:** V1, V5, V6, V9.
- **Where:** `packages/lucent/app.plugin.js`, the iOS build step
  (`packages/runtime/native/LucentNative.podspec`, or a Podfile hook the
  config plugin adds), `packages/lucent/src/cli/pipeline.ts` and
  `project.ts` (the deferral).

- [ ] Run `lucent build` from the iOS build once pods are installed, the
      iOS counterpart of Android's `lucentBuild` Gradle task: a podspec
      `script_phase` or a Podfile `post_install` hook, whichever runs
      after the package's pods are installed and before the native
      package compiles.
- [ ] In `expo prebuild`, a package pod missing from `Podfile.lock` defers
      iOS binding with a warning that names the pod and the step that
      binds it, instead of failing with LUCENT3004; the config plugin
      then links the native package, so prebuild's `pod install`
      installs the pod.
- [ ] A test with a Lucent package that imports a pod its `lucent.json`
      declares: a fresh `expo prebuild` succeeds, the iOS build binds the
      pod, and a pod the build still cannot find fails with LUCENT3004
      naming it.
- [ ] The smoke install (`node scripts/smoke-install.ts`) covers such a
      package in its fresh Expo app, and the docs on Lucent packages'
      pods describe the Expo flow.

**Done when:** a fresh Expo app with a Lucent package that imports its
own pod runs `expo prebuild` and builds for iOS with that pod bound, no
manual `pod install` or `lucent build` in between.

**Notes:** From fix/package-pod-first-build, which named the steps a
bare app takes and found that Expo's prebuild stops before them.

<a id="t67"></a>

### T67: Pass the integrated production-candidate gate

**Goal:** Validate the integrated result and prepare a release candidate
that is ready for pilots.

- **Status:** waiting on the open tasks in Needs.
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

- The deferred device checks (see [Known limitations](limitations.md#deferred-checks-need-the-maintainer))
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

<a id="t68"></a>

### T68: Prepare independent author and app pilot packages

**Goal:** Give independent library authors and app teams material they can
complete without a maintainer's help.

- **Status:** waiting on the open tasks in Needs.
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

- **Status:** waiting on the open tasks in Needs.
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

- **Status:** waiting on the open tasks in Needs.
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

## Performance budgets

Host budgets are enforced by `node scripts/bench.ts --check` (kernel
speedups, boundary batching, and a host-call floor of 1.25x a handwritten
C++ TurboModule). CI's shared runners enforce the kernels' budgets and
report the boundary and floor ratios, which move with the CPU
(`--shared-runner`); a stable machine enforces them all. The design's device budgets are targets until physical
devices measure them; a missed target is recorded and decided, never
quietly weakened.

| Id  | Dimension           | Workload                                          | Gate                                                                                        | State                                                                                  |
| --- | ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1  | Primitive calls     | Boundary `add` and `concat`, 1,000 calls          | Within 1.25x a bare host function (host); within 20% of the fastest framework path (device) | Host checked; device open ([T65](#t65))                                                |
| P2  | Computation         | The benchmark kernels                             | No regression of the kernel budgets; within 20% of handwritten native for selected kernels  | Host checked; host native references measured ([T54](#t54)); device open ([T65](#t65)) |
| P3  | Binary transport    | `NativeBuffer` handoff of 1 KB, 1 MB and a stream | No payload copy on owned handoff; copies and allocations counted                            | Implemented (T31, T32); device open                                                    |
| P4  | View frames         | A steady-state wrapper workload                   | p95 frame work within 16.7 ms (60 Hz) or 8.3 ms (120 Hz), under 1% missed                   | Open (T65, devices)                                                                    |
| P5  | UI isolation        | Busy JavaScript plus a 500 ms compute task        | No equivalent UI stall; lock and queue waits reported                                       | Simulator and emulator evidence (T44); device open                                     |
| P6  | Teardown and memory | 1,000 mount/dispose and subscribe/cancel cycles   | Owned counts return to baseline, no retained growth                                         | Open ([T64](#t64))                                                                     |
| P7  | Feedback            | A fixture app's edit loop                         | p95 warm diagnostics under 500 ms; check and generation under 1 s                           | Met on 53 modules (p95: diagnostics 486 ms, check 941 ms, build 959 ms)                |
| P8  | Startup and size    | Empty app, one module, one view, many packages    | Budgets set at first measurement                                                            | Open ([T62](#t62), [T65](#t65))                                                        |
| P9  | Reliability         | Sanitizers and stress                             | No use-after-free, deadlock or cross-thread JSI access                                      | Host sanitizers clean; stress open ([T64](#t64))                                       |

Benchmarks keep raw samples, report median, p95 and p99, separate
throughput from latency, interleave implementations after warmup, verify
outputs, and rerun noisy threshold crossings before calling a regression.

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

### SDK coverage

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
every revision, in [docs/design/contracts.md](design/contracts.md):
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

## Design slices and tasks

The design specification delivers its work in slices S01–S23; this table
maps each slice to the tasks that carry it, so none is dropped. Task
details stay in this file; slice details stay in the
[design](design/native-platform.md#18-implementation-slices-and-concrete-tests).

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

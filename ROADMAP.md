# Lucent roadmap

Lucent compiles TypeScript modules and components to C++ that React Native
calls over JSI. This file is the plan in brief: the principles, the gates,
what's next and where the rest lives. The website's
[roadmap page](https://lucent-lang.dev/docs/releases/roadmap/) is generated
from its [status at a glance](#status-at-a-glance) and from
[docs/limitations.md](docs/limitations.md).

Updated 2026-10-08.

| Where                                                                                                                    | What it holds                                                                                                                                                                           | Updated when                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [docs/tasks.md](docs/tasks.md)                                                                                           | Every task with its status, needs and checklist, by gate; the requirements, performance budgets, validation profiles, contracts and design slices                                       | A commit finishes, changes or adds a task                        |
| [docs/decisions/](docs/decisions/)                                                                                       | One file per decision, numbered, with its date, what was decided, why and what it changed                                                                                               | A decision is made; a new one supersedes an old one, which stays |
| [docs/limitations.md](docs/limitations.md)                                                                               | Known limitations and the checks that need the maintainer                                                                                                                               | A limitation is found or lifted                                  |
| [packages/lucent/CHANGELOG.md](packages/lucent/CHANGELOG.md)                                                             | What each release shipped                                                                                                                                                               | Changesets, at release                                           |
| [docs/design/](docs/design/)                                                                                             | The design ([overview](docs/design/overview.md), [native-platform.md](docs/design/native-platform.md)), the [contracts](docs/design/contracts.md) and the [views](docs/design/views.md) | A contract or the design changes, by revision                    |
| [docs/architecture.md](docs/architecture.md), [docs/semantics.md](docs/semantics.md), [docs/testing.md](docs/testing.md) | How the code works, the language spec, the test suites                                                                                                                                  | The code they describe changes                                   |

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
work: **one implementation is the spec** (no separate module specs or
schemas), **discover the installed native world** (no catalog of SDKs or
bindings), **make costs predictable** (copies, threads, ownership and
rebuilds are explained) and **finish real integrations** (lifecycle,
permissions, packaging, debugging and upgrades are part of a module).

Two supported paths reach native code: automatic TypeScript bindings for
every representable native declaration, and a typed extension path for
what metadata cannot express. Ordinary modules need no handwritten Swift,
Kotlin or C++. An opaque native library may need a small adapter, which
stays part of the same Lucent package and build.

Every task keeps the [requirements](docs/tasks.md#requirements): no
curated catalog, JavaScript semantics, thread ownership, UI isolation,
copy by default, generated code through `packages/codegen`, contracts
first and honest evidence. The design in brief is
[docs/design/overview.md](docs/design/overview.md).

<a id="not-planned"></a>

Not planned: running JavaScript in native code (there is no engine there);
reflection, `eval` and prototypes; freeing reference cycles automatically
(they leak until broken, and Debug builds report what's left at teardown).

## Status at a glance

Lucent 0.2.0 is on npm as `@lucent-lang/lucent` (2026-10-06). It contains
the language, platform bindings with generated Swift and Kotlin, Swift
packages, isolated compute, native buffers, typed native extensions, the
CLI, and native views: UIKit and Android views, and SwiftUI and Jetpack
Compose bodies written as JSX. Since 2026-10-07 every build generates
views, still in preview.

Everything is tested on hosts, the iOS simulator and the Android emulator.
Nothing has run on a physical device yet: those checks are deferred to the
maintainer ([limitations](docs/limitations.md#deferred-checks-need-the-maintainer)).

| Gate | Meaning                                      | Closing task             | State                  |
| ---- | -------------------------------------------- | ------------------------ | ---------------------- |
| G0   | Dispatch ready: baseline and first contracts | T00, T01                 | done (2026-09-25)      |
| G1   | Automatic binding ready                      | [T28](docs/tasks.md#t28) | done (2026-10-04, #68) |
| G2   | View architecture proved                     | T44                      | done (2026-09-26)      |
| G3   | Wrapper preview ready                        | [T52](docs/tasks.md#t52) | open                   |
| G4   | Production candidate                         | [T67](docs/tasks.md#t67) | open                   |
| G5   | Production recommendation                    | [T70](docs/tasks.md#t70) | open                   |

What's next, in order of readiness ([docs/tasks.md](docs/tasks.md#status)
has every task's state):

1. [T52](docs/tasks.md#t52): wrapper ports and the views preview, which
   closes G3; it needs physical devices.
2. [TA35](docs/tasks.md#ta35): bind a package's own pods in an Expo app.
3. [T63](docs/tasks.md#t63): the no-catalog audit, now that T28, T48 and
   T50 are done.
4. [T60](docs/tasks.md#t60): headless, background and other native
   targets, independent of the view work.
5. A scope decision on [T51](docs/tasks.md#t51), which as written
   conflicts with [decision 0012](docs/decisions/0012-jsx-for-swiftui-and-compose-with-no-wrappers.md)
   against a cross-platform view vocabulary.

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
- ✅ Native libraries nobody has seen before, bound and run with no change to Lucent.
- ✅ The app's Swift packages, bound against the iOS version the app targets.
- 🔭 Weak references.

### Views

Goal: Native views from Lucent components, rendered by React Native's Fabric.

- ✅ Components in `.lucent.tsx` that render UIKit and Android views, in every build (in preview).
- ✅ SwiftUI and Jetpack Compose bodies written as JSX, from declarations read from your SDKs.
- ✅ One file per component, with each platform's body in a platform branch.
- ✅ Events, commands, requests that answer, recycling, sizing to content and React children.
- ✅ Views that keep updating while JavaScript is blocked.
- ✅ JSX for any SDK view, keyed lists and Yoga layout.
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

## Performance budgets

Host budgets are enforced by `node scripts/bench.ts --check`; device
budgets are targets until physical devices measure them, and a missed one
is recorded and decided, never weakened.
[docs/tasks.md](docs/tasks.md#performance-budgets) has the table (P1 to
P9).

## Recording work

- A task's status, needs and checklist change in
  [docs/tasks.md](docs/tasks.md), in the commit that changes them. A new
  task takes the next free id there.
- A decision is a new file, `docs/decisions/NNNN-<slug>.md`, with the next
  number, its date, what was decided, _Why:_ and _Changed:_. It never
  edits an earlier decision's text; it names the one it supersedes, and
  the index in [docs/decisions/README.md](docs/decisions/README.md) gets a
  row.
- A limitation found or lifted changes [docs/limitations.md](docs/limitations.md).
- The [status at a glance](#status-at-a-glance) changes when an area's
  line does: the website shows it.

# Lucent roadmap

Lucent compiles TypeScript modules and components to C++ that React Native
calls over JSI. This file is the plan in brief: the goal, the principles,
the gates and what's next. The website's
[roadmap page](https://lucent-lang.dev/docs/releases/roadmap/) is generated
from its [status at a glance](#status-at-a-glance) and from
[docs/limitations.md](docs/limitations.md).

Updated 2026-10-12, when the plan was rewritten from scratch
([decision 0080](docs/decisions/0080-the-plan-is-rewritten-for-parity-with-nitro-and-expo-modules.md)).

| Where                                        | What it holds                                                                    | Updated when                              |
| -------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| [docs/parity.md](docs/parity.md)             | What Nitro and Expo Modules let an author build, and where Lucent stands on each | A row's state changes                     |
| [docs/tasks.md](docs/tasks.md)               | Every task with its status, needs and checklist, by gate; budgets and validation | A commit finishes, changes or adds a task |
| [docs/limitations.md](docs/limitations.md)   | What Lucent doesn't do yet, and what hasn't been verified                        | A limitation is found or lifted           |
| [docs/decisions/](docs/decisions/)           | One file per decision, numbered, with what was decided, why and what it changed  | A decision is made                        |
| [docs/design/](docs/design/)                 | The design, the contracts between its parts, and the views                       | A contract or the design changes          |
| [docs/](docs/) reference pages               | How the code works, the language's semantics, bindings, packages and tests       | The code they describe changes            |
| [CHANGELOG.md](packages/lucent/CHANGELOG.md) | What each release shipped                                                        | Changesets, at release                    |

## The goal

**Build any module Nitro or Expo Modules can build, views included, from
one TypeScript source.** A module is a `.lucent.ts` file in a checked
subset of TypeScript; a component is a `.lucent.tsx` file. Lucent compiles
both to C++ behind one C++ TurboModule, with the Swift and Kotlin it
generates where an SDK needs them. The target is React Native's New
Architecture on iOS and Android, in bare and Expo apps.

[docs/parity.md](docs/parity.md) lists every capability the two systems
offer an author, and the gates below close when each row is done. Where
Nitro or Expo leaves the author to write Swift, Kotlin or C++ by hand
(background tasks, services, extensions), Lucent's row is that code
written in TypeScript against the SDK.

## Principles

- **The source is the spec.** A module's TypeScript is its API: no
  separate spec, schema or hand-written declarations.
- **No catalog.** SDK and library APIs are read from what's installed, so
  a library Lucent has never seen binds like the SDK.
- **JavaScript semantics.** Code behaves as the same code run as
  JavaScript, or fails to compile with a `LUCENT` diagnostic that says
  why.
- **Mechanisms in core, APIs in packages.** Core provides entry points,
  threads, buffers and lifecycle events. A background-task scheduler or a
  notifications API is a Lucent package built on them.
- **Predictable costs.** Copies, threads, ownership and rebuilds are
  explicit, and Lucent explains each one.

[docs/tasks.md](docs/tasks.md#requirements) states the requirements every
task keeps.

<a id="not-planned"></a>

Not planned: running JavaScript in native code (there is no engine there);
reflection, `eval` and prototypes; freeing reference cycles automatically
(they leak until broken or go through a `WeakRef`, and Debug builds report
what's left at teardown); a cross-platform view library of primitives,
lists, gestures and animations (components wrap platform views, SwiftUI or
Compose); Apple platforms other than iOS, and Android TV or Wear, until
parity on phones and tablets.

## Status at a glance

Lucent 0.2.0 is on npm as `@lucent-lang/lucent` (2026-10-06), and `main`
has moved on since: ✅ below means done on `main`, and some of it waits for
the next release. Modules, platform bindings with generated Swift and
Kotlin, isolated compute, native buffers, typed C extensions, the CLI and
native views (in preview) all work. Everything is tested on hosts, the iOS
simulator and the Android emulator, and nothing has run on a physical
device.

The website shows the following areas. Each line is one short sentence:
✅ done · 🚧 in progress · ⏳ next · 🔭 later.

### Modules

Goal: Write a module once in TypeScript, and call it from JavaScript as a native module.

- ✅ Statements, classes, generics, unions, closures, generators, regular expressions and JSON.
- ✅ `async` and `await` off the JS thread, `AbortSignal`, and JS callbacks and promises both ways.
- ✅ Exported classes whose instances keep their identity in JavaScript.
- ✅ `bigint` of any size, with every native 64-bit integer as one.
- ✅ Events through `EventEmitter`, and hooks for listeners starting and for a module ending.
- ✅ `NativeBuffer` and moved `ArrayBuffer`s, which pass bytes without copying.
- 🚧 Native handles, and memory-pressure hints for objects that hold native memory.
- ✅ Every typed array and `DataView`, copied, lent and moved as `Uint8Array` is.
- ✅ `null` kept apart from `undefined` in every container.
- ⏳ JSON-shaped values through recursive union types.
- ⏳ Promise chaining and combinators, timers, and web APIs such as `TextEncoder` and `URL`.
- ⏳ Classes that extend `EventEmitter`, so native objects have their own listeners.

### Platform APIs

Goal: Call the iOS and Android SDKs, and the libraries an app links, directly from Lucent.

- ✅ SDK types read from your Xcode and Android SDK on first import, then cached.
- ✅ Swift-only and Kotlin-only APIs, such as StoreKit 2 and `Flow`, through generated code.
- ✅ Delegates, listeners, blocks and subclasses, with completion handlers as promises.
- ✅ OS version checks and main-thread-only APIs, checked at compile time.
- ✅ Pods, Gradle dependencies, Swift packages and C libraries.
- ✅ The current Activity and scene, activity results, permission requests and app lifecycle events.
- 🚧 Platform memory as JavaScript bytes without a copy, done for Android's `ByteBuffer`.
- ⏳ Opened URLs, push tokens, notifications and back presses, from the app delegate and Activity.
- ⏳ Native needs declared by the app's own modules, not only by packages.
- ⏳ Privacy manifests, Android `<queries>` and Gradle plugins, declared by packages.
- 🔭 C++ libraries, and a package's own Kotlin and Java, typed in Lucent.
- 🔭 Swift, Kotlin and C++ that call Lucent modules.

### Execution modes

Goal: Lucent code runs wherever the platform calls it, on the thread it needs, with or without JavaScript.

- ✅ Modules that don't import each other on threads of their own, which never block the main thread.
- ✅ `main()` for main-thread work, and `compute` for parallel work that shares no state.
- ✅ Swift `async` and Kotlin `suspend` APIs as promises, cancelled through `AbortSignal`.
- ✅ Channels that carry values between threads, bounded, with a drop policy.
- 🚧 Executors, so platform callbacks run on a queue of their own.
- ⏳ Module code that runs with no JavaScript runtime.
- 🔭 Android services, receivers, workers and widgets written as Lucent classes.
- 🔭 iOS background tasks, background downloads and silent pushes.
- 🔭 iOS app extensions and widgets, with SwiftUI bodies.
- 🔭 App Intents, Live Activities and Android widget bodies.
- 🔭 Calls from worklet runtimes.

### Views

Goal: Native views from Lucent components, rendered by React Native's Fabric.

- ✅ Components that render UIKit and Android views, in preview.
- ✅ SwiftUI and Jetpack Compose bodies written as JSX, from your SDKs' declarations.
- ✅ Typed props, events, commands that answer, React children and sizing to content.
- ✅ Recycling, keyed lists and Yoga layout, and views that update while JavaScript is blocked.
- ⏳ Instances of exported classes as props, such as a video player.
- ⏳ React Native's own view props, such as `testID` and `onLayout`.
- 🔭 View controllers as component roots, such as `AVPlayerViewController`.
- 🔭 A component's ref passed to a module function, as view capture needs.

### Distribution and tooling

Goal: Build and ship Lucent modules and packages like any React Native library.

- ✅ `@lucent-lang/lucent` on npm, for bare and Expo apps, with autolinking and a config plugin.
- ✅ Lucent packages on npm, with `lucent.json` for their native needs.
- ✅ Incremental builds, rebuilds as you edit, and Lucent's errors in the editor.
- ✅ Crashes and errors that point at `.lucent.ts` lines.
- ✅ A JavaScript `lucent:core`, so Jest and Vitest run shared modules.
- ✅ Performance budgets for calls, kernels and size, checked in CI.
- 🚧 React Native 0.85 to 0.87 and Expo SDK 56 and 57, with fresh apps built nightly.
- ⏳ iOS builds from Xcode alone, and a package's pods in Expo apps.
- 🔭 A web target for shared modules.
- 🔭 Monorepos, upgrades and Release builds, tested as a matrix.
- 🔭 Reference ports, benchmarks against Nitro and Expo Modules, and migration guides.

## Gates

A gate closes when every task in its range is done. Gates share some
dependencies, which each task lists; the production candidate needs the
other four.

| Gate                 | Meaning                                                                                        | Tasks                           | State |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- | ----- |
| Module parity        | The values, objects, events, threads, app events and configuration a Nitro or Expo module has  | [T100–T115](docs/tasks.md#t100) | open  |
| View parity          | Props of any type, React Native's view props, controller roots, objects in toolkit bodies      | [T120–T125](docs/tasks.md#t120) | open  |
| Execution modes      | Code that runs with no JavaScript, in background tasks, services, extensions and worklets      | [T130–T136](docs/tasks.md#t130) | open  |
| Distribution         | Fresh apps on each supported release build and run; packages build like any library            | [T140–T145](docs/tasks.md#t140) | open  |
| Production candidate | Ports prove each row, stress and budgets pass, CI runs what it claims, the docs cover each row | [T150–T157](docs/tasks.md#t150) | open  |

## What's next

In order ([docs/tasks.md](docs/tasks.md#status) has every task's state):

1. [T140](docs/tasks.md#t140): the window's fresh apps now build and run
   nightly; it closes after three green nights in a row.
2. [T110](docs/tasks.md#t110): app-delegate and Activity events, whose
   device runs pass in the bare example; the Expo example's run is left.
3. [T131](docs/tasks.md#t131) and [T132](docs/tasks.md#t132), on the
   native root ([T130](docs/tasks.md#t130), done): Android classes the OS
   makes, and iOS background execution.
4. [T120](docs/tasks.md#t120) and [T121](docs/tasks.md#t121): object props
   and React Native's view props, which most view modules need.
5. [T102](docs/tasks.md#t102) to [T104](docs/tasks.md#t104), after typed
   arrays and `null` kept apart from `undefined` ([T100](docs/tasks.md#t100),
   [T101](docs/tasks.md#t101), done): JSON values, promises and timers.
6. [T141](docs/tasks.md#t141): Xcode builds, and a package's pods in Expo
   apps.

## Recording work

- A task's status and checklist change in [docs/tasks.md](docs/tasks.md),
  in the commit that changes them. A new task takes the next free id in
  its gate's range (T100–T119, T120–T129, T130–T139, T140–T149,
  T150–T159).
- A row of [docs/parity.md](docs/parity.md) changes in the commit that
  changes its state.
- A decision is a new file, `docs/decisions/NNNN-<slug>.md`, with the next
  number, its date, what was decided, _Why:_ and _Changed:_. It never
  edits an earlier decision; it names the one it supersedes, and the index
  in [docs/decisions/README.md](docs/decisions/README.md) gets a row.
- A limitation found or lifted changes [docs/limitations.md](docs/limitations.md).
- The [status at a glance](#status-at-a-glance) changes when an area's
  line does: the website shows it.

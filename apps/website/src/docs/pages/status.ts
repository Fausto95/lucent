import type { Block } from "../types";

export const blocks: Block[] = [
    {
      kind: "note",
      tone: "warn",
      text: "Lucent is experimental. The language subset and the APIs change without a migration path. Do not ship it in a production app yet.",
    },
    {
      kind: "p",
      text: "The example apps' test screens pass on the iOS simulator and the Android emulator, in both a bare React Native app and an Expo app. Lucent has **not been tested on physical devices** yet.",
    },
    { kind: "h2", text: "Today and not yet" },
    {
      kind: "table",
      head: ["Area", "Today", "Not yet"],
      rows: [
        [
          "Language",
          "Structs, unions, classes (inheritance, interfaces), closures, generics, `async`/`await`, generators, errors, and the common built-ins",
          "Out of scope for now: reflection, `eval`, prototypes, cycle collection",
        ],
        ["Boundary", "Sync and async exports, JS callbacks, promises, `AbortSignal`, class instances with stable identity", "—"],
        ["Tooling", "One package, `@lucent-lang/lucent`: `lucent build`, `check`, `dev`, `init`, `doctor`, `explain`, `sdk`, `bench`; the Metro integration, the Expo plugin, the TypeScript editor plugin", "npm packages"],
        [
          "Platform APIs",
          "Platform modules; Android bindings generated from `android.jar`; a hand-written UIKit subset on iOS",
          "Bindings generated from the iOS SDK; delegates and protocols",
        ],
        ["Views", "—", "Native views from Lucent components"],
        ["Distribution", "Modules in your own app", "Libraries that ship Lucent modules"],
      ],
    },
    { kind: "h2", text: "Milestones" },
    { kind: "h3", text: "M0: Foundations (done)" },
    {
      kind: "p",
      text: "The value model and runtime, the pure C++ TurboModule with autolinking on both platforms, the compiler with `#line` mapping, `lucent build`, the Metro transformer and the Expo plugin. A test harness runs every module through real JSI on Hermes and compares it with the same code run as JavaScript.",
    },
    { kind: "h3", text: "M1: The language (done)" },
    {
      kind: "p",
      text: "Complex, self-contained modules (parsers, codecs, crypto, data structures) can be written in Lucent: the full statement and expression set, classes, closures, generics, coroutines, callbacks, cancellation and integer inference. See [the language](/docs/language/).",
    },
    { kind: "h3", text: "M2: Platform APIs (in progress)" },
    {
      kind: "p",
      text: "The goal is to import iOS and Android SDK APIs directly, for example `lucent:ios/AVFoundation` or `lucent:android/android.os`.",
    },
    {
      kind: "list",
      items: [
        "Done: the M2.0 spike. Platform modules (`*.ios.lucent.ts`, `*.android.lucent.ts`) checked against a shared declaration, Objective-C++ and JNI calls, main-thread APIs checked at compile time. A port of `expo-haptics` passes next to the original package.",
        "Done: Android bindings generated from `android.jar` (API level 37, the level React Native 0.88 compiles against).",
        "Now: iOS uses a hand-written UIKit subset. Generating iOS bindings from the SDK headers is planned, followed by Swift-only and Kotlin-only APIs, delegates and protocols, and resource lifetimes.",
        "Planned: libraries that ship Lucent sources, compiled into the app's native package.",
      ],
    },
    { kind: "p", text: "What is available now is described in [platform APIs](/docs/platform-apis/)." },
    { kind: "h3", text: "M3: Views (planned)" },
    { kind: "p", text: "SwiftUI or UIKit and Compose or Android views written as Lucent components, on Fabric." },
    { kind: "h3", text: "M4: Production readiness (partly done)" },
    {
      kind: "list",
      items: [
        "Done: incremental builds and watch mode, crash symbolication to `.lucent.ts` lines, Lucent frames in JS error stacks, editor diagnostics.",
        "In progress: publishing `@lucent-lang/*` to npm. The packages build and install from tarballs in CI, but are not published yet.",
        "In progress: performance budgets. CI fails when a benchmark's speedup over the same code as JavaScript drops below its minimum. Comparisons with hand-written C++, Swift and Kotlin are still to come.",
        "Not yet: testing on physical devices.",
      ],
    },
    { kind: "h2", text: "More detail" },
    {
      kind: "p",
      text: "The [roadmap](https://github.com/Fausto95/lucent/blob/cpp-jsi/ROADMAP.md) in the repository tracks each item.",
    },
];

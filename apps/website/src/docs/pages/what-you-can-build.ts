import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "what-you-can-build",
  title: "What you can build today",
  description:
    "The shapes of native module Lucent covers right now, the ones it does not cover yet, and what each missing one is waiting on.",
  blocks: [
    {
      kind: "p",
      text: "Lucent covers call-in, call-out native work: you call a module, it does something in Swift or Kotlin, it returns. Everything in the first table has been executed on both toolchains and runs in the example apps. Everything in the second table is honest about what is missing, not a schedule.",
    },
    { kind: "h2", text: "Modules you can build today" },
    {
      kind: "table",
      head: ["Module", "What it gives you"],
      rows: [
        [
          "**Computation and data**",
          "Sync or async functions over numbers and sized integers, strings, booleans, records, tagged unions, arrays, maps, `Uint8Array` and optionals. Parsing, checksums, geometry, buffer and pixel work. [Language →](/docs/language/)",
        ],
        [
          "**Stateless SDK wrappers**",
          "Bind real SDK functions through a package manifest carrying Swift and Kotlin bodies, with typed capabilities, `Platform.OS` guards, minimum-version contracts, thread placement, overload groups and SDK enums. [Platform and capabilities →](/docs/language/platform-and-capabilities/)",
        ],
        [
          "**Stateful native objects**",
          "A class whose state stays in native memory while JavaScript holds a handle, calls synchronous methods and calls `dispose()`. Leases keep the object alive across a call and per-object locks serialize bridge entry. [Native classes →](/docs/language/native-classes/)",
        ],
        [
          "**Cancellable background work**",
          "`@Background` with `CancellationSource` checkpoints, and `TaskScope` whose close rejects new work, cancels active tasks and waits until each one actually reports completion. [Threads →](/docs/language/threads/)",
        ],
        [
          "**Native → JavaScript events**",
          "`event<T>()` emitted from native code; the app subscribes and removes. Payloads are scalars, records, arrays, maps and nullable values. [Events →](/docs/language/events/)",
        ],
        [
          "**Native views**",
          "`.lucent.tsx` rendered by SwiftUI and Jetpack Compose: stacks, `Text`, `Button`, `TextField`, `Toggle`, `Slider`, `ScrollView`, keyed `For`, one `children` slot, and scalar `state()` owned by the host instance. [Native views →](/docs/language/native-views/)",
        ],
        [
          "**Synchronous delegate callbacks**",
          "`lucent sdk delegate` generates a real protocol conformance whose requirements are answered by compiled Lucent, each with a mandatory typed error policy. Use it where an SDK asks a question and needs an answer on its own executor. [Library manifest →](/docs/api/library-manifest/)",
        ],
      ],
    },
    { kind: "h2", text: "What is not there yet" },
    {
      kind: "p",
      text: "The gaps cluster around one thing: state that outlives a single call. A module you call is well covered; a module you register and later tear down is not.",
    },
    {
      kind: "table",
      head: ["Not yet", "What is missing"],
      rows: [
        [
          "**Listener and subscription modules** — register a handler with an SDK, remove it later",
          "Owned subscriptions with idempotent, reentrant-safe removal; retention where the SDK keeps only a weak reference; quiescing in-flight delivery and releasing captures on teardown. A delegate can be constructed and kept owned, but nothing manages its lifetime for you.",
        ],
        [
          "**Session and resource modules** — a capture session, an audio engine, a BLE connection, a socket, a file watcher",
          "Runtime close: rejecting new work, cancelling and quiescing what is pending, then running SDK cleanup on the required executor. Using a closed reference is a compile-time error today, but no runtime behaviour stands behind it, and operation scopes are not wired to SDK cancellation adapters.",
        ],
        [
          "**Views that own native resources for their lifetime**",
          "Component instance IR, dependency-scoped effects with cleanup, component-owned resource slots, mount versus visibility versus app foreground, typed focus and scroll references, and lazy collections. `state()` covers scalar control state and nothing more.",
        ],
        [
          "**Importing a whole SDK automatically**",
          "Structured extraction reads public Swift free functions and public Java static methods over scalar types. Classes, Objective-C, Kotlin metadata, protocols, generics and inherited members still need a hand-written manifest.",
        ],
        [
          "**Camera-style streaming features**",
          "Blocked by the three rows above. The frame processor itself compiles, and 1,000 synthetic frames run through generated delegates on both toolchains with every frame closed; permissions, preview, typed sessions and backpressure do not exist.",
        ],
      ],
    },
    { kind: "h3", text: "Smaller limits worth knowing" },
    {
      kind: "list",
      items: [
        "There is no `try`/`catch` inside Lucent. A module throws a `LucentError`; recovery happens in JavaScript. [Async and errors →](/docs/language/async-and-errors/)",
        "Class methods are synchronous, and an async function cannot take a Lucent-authored shared object. Curated SDK references marked owned and transferable are the one exception.",
        "Enums are parameter, return and local types only. They cannot be record fields, event payloads, or sit inside arrays, maps or optionals; carry the case through those as a plain string.",
        "A function value cannot cross into JavaScript. Callbacks stay native; use `Event<T>` to notify the app.",
        "No `switch`, no generics, no `any`, no dynamic property access. Everything outside the subset fails at build time with an `LUCENT` code. [Diagnostics →](/docs/language/diagnostics/)",
      ],
    },
    { kind: "h2", text: "The short version" },
    {
      kind: "p",
      text: "Sync or async, stateless or handle-based, with native UI on top: that works today, on Expo and Nitro, on iOS and Android. Subscription-shaped work does not, and it is one coherent slice rather than five scattered ones — subscriptions and explicit close, which together unlock the session and camera rows. Every open item, and the evidence it has to produce, is tracked in the [roadmap](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md).",
    },
  ],
};

import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "what-you-can-build",
  title: "What you can build today",
  description:
    "What Lucent covers in CI and the example apps, and what still needs real devices or a release.",
  blocks: [
    {
      kind: "p",
      text: "Lucent compiles call-in / call-out native modules and views. The first table is exercised in verifies and the example apps. The second table is still open for a production claim.",
    },
    { kind: "h2", text: "You can build" },
    {
      kind: "table",
      head: ["Shape", "What you get"],
      rows: [
        [
          "**Computation and data**",
          "Sync or async functions over numbers, sized integers, strings, booleans, records, unions, arrays, maps, bytes and optionals.",
        ],
        [
          "**SDK bindings**",
          "Package manifests with ownership, executors, capabilities, platform guards, overloads and enums. [Platform →](/docs/language/platform-and-capabilities/)",
        ],
        [
          "**Stateful objects**",
          "Native classes with JS handles, `dispose()`, leases and per-object locking. [Native classes →](/docs/language/native-classes/)",
        ],
        [
          "**Resources and subscriptions**",
          "Closeable resources with leases, owned subscriptions, `resourceScope` / `scope.own`, move and copy. Cells for mutable closure state.",
        ],
        [
          "**Concurrency**",
          "`CancellationSource`, `TaskScope`, task groups, `@Background`. [Threads →](/docs/language/threads/)",
        ],
        [
          "**Events and delegates**",
          "`event<T>()` to JS; generated protocol conformances with typed error policies.",
        ],
        [
          "**Native views**",
          "`.lucent.tsx` with SwiftUI / Compose, `state()`, `resource()`, sync or async `effect()`, keyed `For`. [Native views →](/docs/language/native-views/)",
        ],
        [
          "**Acceptance packages (CI stubs)**",
          "`@lucent-lang/camera`, bluetooth, sqlite, location, background, streaming — in-memory natives and verify scripts, not full device SDKs yet.",
        ],
      ],
    },
    { kind: "h2", text: "Not ready to claim" },
    {
      kind: "table",
      head: ["Gap", "Status"],
      rows: [
        [
          "**Device camera / BLE / OS background**",
          "CI stubs and synthetic frames exist. Physical preview, permissions UX and host stress on Expo + Nitro are still open.",
        ],
        [
          "**Whole-SDK import**",
          "Swift symbol graphs and limited Java extraction help; classes, Obj-C, Kotlin metadata and full overlays still need curation.",
        ],
        [
          "**Production tooling**",
          "LSP diagnose / hover / goto / refs are stubs. Full native→Lucent source maps, npm publish and approved perf budgets are not done.",
        ],
      ],
    },
    { kind: "h3", text: "Smaller limits" },
    {
      kind: "list",
      items: [
        "No `try`/`catch` inside Lucent — throw `LucentError`, recover in JS.",
        "No user generics, `any`, `switch`, or function values across the JS bridge.",
        "Enums are not nested in records / arrays / events yet — carry cases as strings there.",
      ],
    },
    { kind: "h2", text: "Short version" },
    {
      kind: "p",
      text: "Example-app modules and views work on Expo and Nitro. Session-shaped packages compile against CI stubs. A production camera or BLE feature still needs device evidence — tracked in the [roadmap](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md).",
    },
  ],
};

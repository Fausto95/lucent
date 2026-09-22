import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/events",
  title: "Events",
  description: "Declare a typed event at module scope, emit it from native code, subscribe from the app.",
  blocks: [
    {
      kind: "code",
      filename: "progress.lucent.ts",
      code: 'import { event } from "@lucent-lang/events";\n\nexport type Progress = { percent: number; label: string };\nexport const progress = event<Progress>();\n\nexport function report(percent: number): void {\n  progress.emit({ percent, label: "native" });\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { progress, report } from "./src/progress.lucent";\n\nconst subscription = progress.subscribe(({ percent }) => {\n  console.log(percent);\n});\nreport(42);\n\nsubscription.remove(); // when the consumer unmounts',
    },
    { kind: "h2", text: "Rules" },
    {
      kind: "list",
      items: [
        "Payloads are JSON-compatible: scalars, records, arrays, maps and nullable values. `event<void>()` emits with no argument.",
        "Bytes, native class instances, callbacks, views and non-finite numbers cannot be payloads.",
        "`emit` is only callable from Lucent source; `subscribe` only from the app. Native code emits, the app listens.",
        "Importing an event from another Lucent file refers to the same native channel.",
        "Events are broadcast to current listeners and never replayed. Delivery follows the host's scheduling.",
        "Native emission snapshots the listener list under a lock and invokes listeners outside it.",
      ],
    },
    {
      kind: "p",
      text: "For callbacks carried by a [native view](/docs/language/native-views/) prop, use the `Event<T>` type from the same package. That is the shape of the app-side listener.",
    },
  ],
};

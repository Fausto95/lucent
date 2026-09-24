import type { Block } from "../../types";
import { diffs } from "../../../generated/tutorial/3-async";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "trip.lucent.ts",
        filename: "src/trip.lucent.ts",
        diff: true,
        code: diffs["src/trip.lucent.ts"]!,
      },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  {
    kind: "p",
    text: "`simplify` keeps the fixes that shape the route, and drops those within `tolerance` meters of a straight line. On a long trip that is slow work, so it's `async`: it runs on the Lucent thread, and the JS thread stays free.",
  },
  {
    kind: "p",
    text: "The `AbortSignal` comes from an `AbortController` in JavaScript. When the screen goes away, `controller.abort()` sets the signal, and `signal.throwIfAborted()` stops the loop with an `AbortError`.",
  },
  {
    kind: "note",
    text: "Aborting doesn't stop Lucent code by itself. It only takes effect where the code checks the signal, or passes it to `delay`.",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "The screen shows `Simplifying…` for a moment, then `4 fixes shape the route.`: one fix sat within 100 meters of the line through its neighbors.",
  },
];

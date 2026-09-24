import type { Block } from "../../types";
import { diffs } from "../../../generated/tutorial/4-errors";

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
    text: "`error(code, message)` from `lucent:core` makes an `Error` with a `code`. JavaScript receives an ordinary `Error`, with the same `message` and `code`, and a stack whose first frame is the line in `trip.lucent.ts` that threw.",
  },
  {
    kind: "p",
    text: "Test the `code`, not the message: codes are for code, messages are for people. Here, a fix that arrives late is skipped, and any other error still reaches React.",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "The screen is unchanged. Metro's output shows the warning for the late fix: `A fix at 300000 ms comes before the last one, at 2400000 ms`.",
  },
];

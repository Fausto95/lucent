import type { Block } from "../../types";
import { diffs } from "../../../generated/tutorial/2-data";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      { label: "trip.lucent.ts", filename: "src/trip.lucent.ts", diff: true, code: diffs["src/trip.lucent.ts"]! },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  {
    kind: "p",
    text: "`Trip` is a class, so JavaScript gets a handle on one native object rather than a copy. Its fixes stay in native code: JavaScript sends each fix once, with `add`.",
  },
  { kind: "h2", text: "What's copied, and what isn't" },
  {
    kind: "list",
    items: [
      "`trip.add(fix)` copies the fix. Changing `fix` in JavaScript afterwards doesn't change the trip.",
      "`trip.summary()` returns a new object on each call: a copy of a `TripSummary` struct.",
      "`trip` itself crosses by reference. Passing it back to Lucent later gives the same object, with its fixes.",
      "`trip.count` is a getter: reading it calls into native code.",
    ],
  },
  {
    kind: "p",
    text: "This is the shape [Design the boundary first](/docs/thinking/boundary-first/) recommends: the data stays native, and small values cross.",
  },
  { kind: "h2", text: "Run it" },
  { kind: "p", text: "The screen shows `5 fixes, 3.55 km, top speed 1.6 m/s`." },
];

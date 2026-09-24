import type { Block } from "../../types";
import { files } from "../../../generated/tutorial/1-shared-logic";

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Over eight steps, you'll build a trip tracker: a module that measures a trip from GPS fixes. Start from the app you set up in [Install Lucent](/docs/install/).",
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "trip.lucent.ts", cpp: true, code: files["src/trip.lucent.ts"]! },
      { label: "JS usage", filename: "App.tsx", code: files["App.tsx"]! },
    ],
  },
  {
    kind: "p",
    text: "Save the module as `src/trip.lucent.ts`. `Fix` is an object type. When JavaScript passes a fix, Lucent checks each field is a number, then copies the fix into a C++ struct.",
  },
  {
    kind: "p",
    text: "`radians` and `EARTH_RADIUS_M` aren't exported, so JavaScript never sees them. Only `distance` and `speed` cross the boundary.",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "Build and run the app as in [Your first module](/docs/first-module/#run-the-app). The screen shows `3.16 km at 1.3 m/s`: the walk from the Eiffel Tower to the Louvre, measured in C++.",
  },
];

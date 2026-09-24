import type { Block } from "../../types";
import { diffs } from "../../../generated/tutorial/6-callbacks";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      { label: "location.lucent.ts", filename: "src/location.lucent.ts", diff: true, code: diffs["src/location.lucent.ts"]! },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  { kind: "h2", text: "iOS: a delegate" },
  {
    kind: "p",
    text: "`Updates` implements `CLLocationManagerDelegate`. Lucent makes an Objective-C object for it that forwards `locationManager(_:didUpdateLocations:)` to `locationManager_didUpdateLocations`: Swift's name, with its labels joined by `_`.",
  },
  { kind: "h2", text: "Android: a listener" },
  {
    kind: "p",
    text: "`LocationListener` has one method to implement, so a plain function is one. `removeUpdates` takes the same function back, which is why `watch` keeps it in `listeners`.",
  },
  { kind: "h2", text: "To JavaScript" },
  {
    kind: "p",
    text: "`onFix` is a JS function. Each update arrives on the Lucent thread and calls it; the call is posted to the JS thread. `watch` returns an id, and `stop(id)` removes the manager or listener, which lets go of the callback.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "Without `stop`, the delegate or listener, and the JS callback it holds, are never freed. See [When memory is freed](/docs/thinking/memory/).",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "With a permission granted, move the simulated location: the summary updates with each fix.",
  },
];

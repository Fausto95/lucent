// The Meter fixture's compiled setup, run: mounted on Mac Catalyst (UIKit)
// the way a platform host mounts it, against React Native's prebuilt
// renderer (mount_run_test.mm drives it).
import { describe, expect, it } from "vite-plus/test";
import { METER } from "./meter-fixture.ts";
import { canRunMounted, runMounted } from "./mount-harness.ts";

/** Every step of the driver, in order. */
const EXPECTED = [
  "mounted: Play / Pause, heard 1",
  "committed: Go / Pause, heard 1",
  // Without the host: the effect that shows the subtitle enters the mount.
  "subtitle removed: Go / 0 changes, heard 1",
  "toggled: sent [on], Go / 1 changes, heard 1",
  "new emitter: first [on], second [off], heard 1",
  "not listening: second [off], Go / 3 changes, heard 1",
  "commands: not selected, answer 7 = 4, heard 2",
  "disposed: callback gone, Go / 4 changes, answer 8 the view is gone",
  // Setup made the button directly: the mount's end releases it.
  "released: native references all released, button gone",
];

describe("a compiled setup, mounted", () => {
  it.skipIf(!canRunMounted)(
    "tracks commits, sends events along replaceable routes, answers commands and ends with its mount, releasing what setup made",
    () => {
      expect(runMounted(METER, "mount_run_test.mm")).toEqual(EXPECTED);
    },
    600_000,
  );
});

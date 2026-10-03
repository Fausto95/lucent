// A component written as JSX of UIKit views (T48), compiled and mounted on
// Mac Catalyst the way a platform host mounts it (native_jsx_run_test.mm
// drives it): its views made by rule, props kept by effects, an event from
// a control, children in a stack view, all released with the mount.
import { describe, expect, it } from "vite-plus/test";
import { canRunMounted, runMounted } from "./mount-harness.ts";
import { SETTINGS } from "./native-jsx-fixture.ts";

describe("a component of UIKit JSX, mounted", () => {
  it.skipIf(!canRunMounted)(
    "makes its views by rule, keeps their props, sends their events and releases them",
    () => {
      expect(runMounted(SETTINGS, "native_jsx_run_test.mm")).toEqual([
        "mounted: 2 arranged, spacing 8, label Hello in 1 line, switch on",
        "committed: label Bye, switch on",
        "switched: sent off",
        "disposed: switch actions none",
        "released: native references all released, stack gone",
      ]);
    },
    600_000,
  );
});

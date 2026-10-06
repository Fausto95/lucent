// Native view JSX whose children come and go (T49), compiled and mounted on
// Mac Catalyst as a platform host mounts it (native_jsx_flow_run_test.mm
// drives it): conditional children by commits, a keyed list moved,
// retitled, shortened and grown, kept views kept, all released.
import { describe, expect, it } from "vite-plus/test";
import { canRunMounted, runMounted } from "./mount-harness.ts";
import { ROWS } from "./native-jsx-flow-fixture.ts";

describe("native view JSX with children that come and go, mounted", () => {
  it.skipIf(!canRunMounted)(
    "shows conditional children and keyed lists, keeping the views it keeps",
    () => {
      expect(runMounted(ROWS, "native_jsx_flow_run_test.mm")).toEqual([
        "mounted: Hello light A B C end",
        "noted: Hello note light A B C end",
        "darkened: Hello note dark A B C end",
        "unnoted: Hello dark A B C end",
        "kept: fixed labels",
        "rotated: Hello dark C A B end",
        "moved: same labels",
        "retitled: Hello dark C A2 B end",
        "renamed: same label",
        "shortened: Hello dark A2 end",
        "grown: Hello dark A2 D end",
        "released: native references all released, stack gone",
      ]);
    },
    600_000,
  );
});

// Native view JSX laid out by Yoga (T50), compiled and mounted on Mac
// Catalyst as a platform host mounts it (native_jsx_layout_run_test.mm
// drives it): a row and a nested column placed by their style, children
// that come and go laid out with them, a stack view keeping its own
// children's frames, right to left, the pixel grid, sizing by content,
// all released.
import { describe, expect, it } from "vite-plus/test";
import { canRunMounted, runMounted } from "./mount-harness.ts";
import { CARD } from "./native-jsx-layout-fixture.ts";

describe("native view JSX laid out by Yoga, mounted", () => {
  it.skipIf(!canRunMounted)(
    "places a Flex's children by their style, one owner for each frame",
    () => {
      expect(runMounted(CARD, "native_jsx_layout_run_test.mm")).toEqual([
        "mounted: title at the padding, children 8 apart, spacer fills the row",
        "column: A B stacked 4 apart, 60 wide",
        "stack: 4 in from its place, its labels where it put them",
        "retitled: title wider, spacer narrower, column in place",
        "widened: column 120 wide",
        "grown: A B C stacked 4 apart",
        "reordered: C A B stacked 4 apart",
        "right to left: title at the right padding",
        "pixels: every frame on the grid",
        "sized by content: fits its children and padding",
        "released: native references all released, row gone",
      ]);
    },
    600_000,
  );
});

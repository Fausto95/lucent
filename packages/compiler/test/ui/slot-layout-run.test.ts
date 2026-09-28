// The fixture's Card, which takes React children, laid out by React
// Native's renderer where its host reports its slot: its children in the
// content box until the first report, then in the slot's rectangle
// (slot_layout_run_test.cpp drives it, on Mac Catalyst against the prebuilt
// renderer).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { fabricSources } from "../../src/ui/fabric.ts";
import { catalystToolchain, reactCommon } from "./react-native-headers.ts";
import { CARD, components } from "./views-fixture.ts";

const toolchain = catalystToolchain();

/**
 * Frames are x,y width x height, in the parent's coordinates; content is
 * the host's content box (left, top, right, bottom insets). Each card is
 * 200 wide with padding 10 and border 2: its content box starts at 12,12.
 * An absolutely positioned child is placed from the padding box, as in a
 * View: the slot, less the card's padding.
 */
const EXPECTED = [
  "before: card 0,0 200x150 content 12,12,12,12 border 2, fill 12,12 176x126, corner 2,2 10x10",
  "before: card 0,150 200x84 content 12,12,12,12 border 2, children 12,12 176x30 and 12,42 176x30",
  "report 1: accepted",
  "header: card 0,0 200x150 content 12,12,12,12 border 2, fill 12,52 176x86, corner 2,42 10x10",
  "report 1: accepted",
  "header: card 0,150 200x124 content 12,12,12,12 border 2, children 12,52 176x30 and 12,82 176x30",
  "report 2: unchanged",
  "report 3: accepted",
  "grown: card 0,0 200x150 content 12,12,12,12 border 2, fill 12,76 176x62, corner 2,66 10x10",
  "report 4: accepted",
  "rtl: card 0,0 200x150 content 12,12,12,12 border 2, fill 20,12 168x126, corner 10,2 10x10",
  "report 5: accepted",
  "filled: card 0,0 200x150 content 12,12,12,12 border 2, fill 12,12 176x126, corner 2,2 10x10",
];

describe("a component taking React children", () => {
  it.skipIf(!toolchain)(
    "lays them out in its slot's rectangle once its host reports it, in its content box before",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-slot-layout-"));

      for (const [name, text] of fabricSources(components())) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
      }

      const driver = path.join(dir, "driver.cpp");

      fs.writeFileSync(
        driver,
        fs
          .readFileSync(path.join(import.meta.dirname, "slot_layout_run_test.cpp"), "utf8")
          .replaceAll("CARD", CARD),
      );

      // Test support React Native's frameworks leave out: building shadow trees from elements.
      const element = path.join(reactCommon(), "react/renderer/element");
      const binary = path.join(dir, "slot_layout");
      const build = spawnSync(
        toolchain!.command,
        [
          ...toolchain!.args,
          `-I${dir}`,
          driver,
          path.join(dir, `views/${CARD}.cpp`),
          path.join(runtimeDir(), "cpp/lucent/report.cpp"),
          ...["ComponentBuilder.cpp", "Element.cpp", "ElementFragment.cpp"].map((f) =>
            path.join(element, f),
          ),
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );

      expect(build.stderr).toBe("");

      const run = spawnSync(binary, { encoding: "utf8" });

      expect(run.status).toBe(0);
      expect(run.stdout.trim().split("\n")).toEqual(EXPECTED);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    180_000,
  );
});

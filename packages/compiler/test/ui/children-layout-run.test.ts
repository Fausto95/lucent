// The fixture's Card, which takes React children, laid out by React
// Native's renderer: a Yoga container of its children, never a measured
// leaf (children_layout_run_test.cpp drives it, on Mac Catalyst against the
// prebuilt renderer).
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

/** Frames are x,y width x height, in the parent's coordinates. */
const EXPECTED = [
  "card: 0,0 200x74",
  "first child: 12,12 176x30",
  "second child: 12,42 176x20",
  "leaf: no, measurable: no",
  "asks its host: no",
];

describe("a component taking React children", () => {
  it.skipIf(!toolchain)(
    "is their Yoga container, sized by its style and children, never measured",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-children-layout-"));

      for (const [name, text] of fabricSources(components())) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
      }

      const driver = path.join(dir, "driver.cpp");

      fs.writeFileSync(
        driver,
        fs
          .readFileSync(path.join(import.meta.dirname, "children_layout_run_test.cpp"), "utf8")
          .replaceAll("CARD", CARD),
      );

      // Test support React Native's frameworks leave out: building shadow trees from elements.
      const element = path.join(reactCommon(), "react/renderer/element");
      const binary = path.join(dir, "children_layout");
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

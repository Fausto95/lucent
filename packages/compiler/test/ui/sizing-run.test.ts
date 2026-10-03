// The fixture's Caption, laid out by React Native's renderer with no size of
// its own: sized by what its host measured, once that reaches its state
// (sizing_run_test.cpp drives it, on Mac Catalyst against the prebuilt
// renderer).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { fabricSources } from "../../src/ui/fabric.ts";
import { catalystToolchain, reactCommon } from "./react-native-headers.ts";
import { CAPTION, components } from "./views-fixture.ts";
import { buildObjects, compileOnly } from "../parallel-build.ts";

const toolchain = catalystToolchain();

/** Each step: the Caption's frame, the constraints it asks its host to measure under, the results judged. */
const EXPECTED = [
  "first layout: 200x0 asks 200x500",
  "result 200x500: accepted",
  "measured: 200x42 asks 200x500",
  "narrowed: 100x42 asks 100x500",
  "result 200x500: stale constraints",
  "result 100x500: accepted",
  "measured again: 100x84.5 asks 100x500",
  "result 100x500: stale revision",
  "result 100x500: unchanged",
  "settled: 100x84.5 asks 100x500",
  "shortened: 100x84.5 asks 100x500",
  "font scale 1.5, wider: 120x84.5 asks 120x380 x1.5",
  "result 120x380: stale constraints",
  "result 120x380 x1.5: accepted",
  "measured at 1.5: 120x105.5 asks 120x380 x1.5",
  "right to left: 120x105.5 asks 120x380 x1.5 rtl",
  "result 120x380 x1.5 rtl: accepted",
  "measured right to left: 120x105.5 asks 120x380 x1.5 rtl",
  "result 120x380 x1.5 rtl after removal: dropped",
];

describe("a component with no size of its own", () => {
  it.skipIf(!toolchain)(
    "is sized by its host's current measurement, and asks for the constraints its layout gives",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-sizing-run-"));

      for (const [name, text] of fabricSources(components())) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
      }

      // Test support React Native's frameworks leave out: building shadow trees from elements.
      const element = path.join(reactCommon(), "react/renderer/element");
      const binary = path.join(dir, "sizing_test");
      // Compiled side by side; React Native's and the runtime's sources, once per run.
      const own = (source: string) =>
        !source.startsWith(reactCommon()) && !source.startsWith(runtimeDir());
      const { objects, printed } = buildObjects(
        dir,
        [
          path.join(import.meta.dirname, "sizing_run_test.cpp"),
          path.join(dir, `views/${CAPTION}.cpp`),
          path.join(runtimeDir(), "cpp/lucent/report.cpp"),
          ...["ComponentBuilder.cpp", "Element.cpp", "ElementFragment.cpp"].map((f) =>
            path.join(element, f),
          ),
        ],
        (source) => ({
          cmd: toolchain!.command,
          args: [
            ...compileOnly(toolchain!.args),
            ...(own(source) ? [`-I${dir}`] : []),
            "-c",
            source,
          ],
        }),
        (source) => !own(source),
      );
      const build = spawnSync(toolchain!.command, [...toolchain!.args, ...objects, "-o", binary], {
        encoding: "utf8",
      });

      expect(printed + build.stderr).toBe("");

      const run = spawnSync(binary, { encoding: "utf8" });

      expect(run.status).toBe(0);
      expect(run.stdout.trim().split("\n")).toEqual(EXPECTED);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    180_000,
  );
});

// The fixture's events through React Native's event dispatcher and queue
// (event_run_test.cpp drives them, on Mac Catalyst against the prebuilt
// renderer): each delivery's order and priority, and what coalescing keeps.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { fabricSources } from "../../src/ui/fabric.ts";
import { catalystToolchain, reactCommon } from "./react-native-headers.ts";
import { components, GAUGE, PICKER } from "./views-fixture.ts";
import { buildObjects, compileOnly } from "../parallel-build.ts";

const toolchain = catalystToolchain();

/**
 * Each event JavaScript receives: tag, type, React priority, arguments.
 * The prebuilt renderer maps a continuous event to React's default
 * priority (its fixMappingOfEventPrioritiesBetweenFabricAndReact flag is
 * off), a discrete one to React's discrete priority.
 */
const EXPECTED = [
  "beat 1",
  "2 topLucent2 default [2]",
  "2 topLucent0 discrete [5]",
  "2 topLucent2 default [5]",
  "4 topLucent2 default [7]",
  '6 topLucent0 default ["a"]',
  '6 topLucent0 default ["b","tap"]',
  "4 topLucent1 discrete []",
  "beat 2",
  "2 topLucent2 default [6]",
];

describe("a component's events", () => {
  it.skipIf(!toolchain)(
    "reach JavaScript in the order sent, at their priority, a coalesced one replacing its view's waiting one",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-event-run-"));

      for (const [name, text] of fabricSources(components())) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
      }

      const binary = path.join(dir, "event_test");
      // Compiled side by side; React Native's and the runtime's sources, once per run.
      const own = (source: string) =>
        !source.startsWith(reactCommon()) && !source.startsWith(runtimeDir());
      const { objects, printed } = buildObjects(
        dir,
        [
          path.join(import.meta.dirname, "event_run_test.cpp"),
          path.join(dir, `views/${GAUGE}.cpp`),
          path.join(dir, `views/${PICKER}.cpp`),
          path.join(runtimeDir(), "cpp/lucent/report.cpp"),
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

      expect(run.stderr).toBe("");
      expect(run.stdout.trim().split("\n")).toEqual(EXPECTED);
      expect(run.status).toBe(0);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    180_000,
  );
});

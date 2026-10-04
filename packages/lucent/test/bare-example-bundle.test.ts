/**
 * The bare example app's Metro bundle holds one react-native (TA25). The
 * workspace's two apps pin different releases, so a package hoisted to the
 * root (`@react-native/virtualized-lists`, FlatList's) can get a react-native
 * of its own; two copies of the renderer's registries make a FlatList fail
 * ("View config getter callback for RCTScrollContentView must be a
 * function"). Bundles an entry using FlatList with the app's own config.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const app = path.resolve(import.meta.dirname, "../../../apps/bare-example");
const cli = path.join(app, "node_modules/react-native/cli.js");

describe("the bare example app's bundle", () => {
  it.skipIf(!fs.existsSync(cli))(
    "holds one react-native, FlatList's included",
    () => {
      const entry = path.join(app, `ta25-entry-${process.pid}.js`);
      const bundle = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bare-bundle-")),
        "b.js",
      );

      fs.writeFileSync(entry, 'import { FlatList } from "react-native";\nconsole.log(FlatList);\n');
      try {
        const r = spawnSync(
          process.execPath,
          [
            cli,
            "bundle",
            ...["--platform", "ios", "--dev", "true", "--minify", "false"],
            ...["--entry-file", path.basename(entry), "--bundle-output", bundle, "--reset-cache"],
          ],
          { cwd: app, encoding: "utf8", timeout: 600_000 },
        );
        expect(r.status, r.stderr).toBe(0);
      } finally {
        fs.rmSync(entry, { force: true });
      }

      // A dev bundle names each module by its path: one registry, the app's react-native's.
      const registries = new Set(
        [
          ...fs
            .readFileSync(bundle, "utf8")
            .matchAll(
              /"([^"]*react-native\/Libraries\/Renderer\/shims\/ReactNativeViewConfigRegistry\.js)"/g,
            ),
        ].map((m) => m[1]),
      );
      expect([...registries]).toEqual([
        "node_modules/react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js",
      ]);
    },
    600_000,
  );
});

/**
 * An app imports a component as lucent:views/<module>:
 * TypeScript finds the React declarations `lucent build` writes through the
 * app's lucent:* path, and Metro bundles the component's own module, once,
 * so the import and a relative `./x.lucent` one register one native view.
 * A scratch app on the workspace's node_modules, built, type-checked with
 * the TypeScript API and bundled with Metro.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { withLucentTsconfig } from "../src/cli/tsconfig.ts";
import { runLucent, runToExit } from "./run-to-exit.ts";

const workspace = path.resolve(import.meta.dirname, "../../..");
const metro = path.join(workspace, "node_modules/metro");

const APP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "scratch-app", version: "0.0.0", private: true }),
  "babel.config.js": 'module.exports = { presets: ["module:@react-native/babel-preset"] };\n',
  "metro.config.js": `const { getDefaultConfig } = require("@react-native/metro-config");
const { withLucent } = require(${JSON.stringify(path.join(workspace, "packages/lucent/metro/index.cjs"))});

const config = getDefaultConfig(__dirname);

config.watchFolders = [${JSON.stringify(path.join(workspace, "node_modules"))}];

module.exports = withLucent(config, { watch: false });
`,
  "src/card.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Props = { title: string; onPress?: () => void };

export declare function Card(props: Props): UIView | View;
`,
  "src/card.ios.lucent.tsx": `import { UILabel, type UIView } from "lucent:ios/UIKit";
import type { Props } from "./card.lucent";

export function Card(props: Props): UIView {
  return <UILabel text={props.title} />;
}
`,
  "src/card.android.lucent.tsx": `import { TextView } from "lucent:android/android.widget";
import type { View } from "lucent:android/android.view";
import type { Props } from "./card.lucent";

export function Card(props: Props): View {
  return <TextView text={props.title} />;
}
`,
  "App.tsx": `import { Card } from "lucent:views/card";

export function App() {
  return <Card title="hello" style={{ flex: 1 }} onPress={() => {}} />;
}
`,
  "Wrong.tsx": `import { Card } from "lucent:views/card";

export function Wrong() {
  return <Card title={1} />;
}
`,
  // A file: Metro's transform workers would run `node -e`'s script again.
  "bundle.cjs": `const Metro = require("metro");

(async () => {
  const config = await Metro.loadConfig({ config: "metro.config.js", resetCache: true });

  await Metro.runBuild(config, { entry: "index.js", platform: "ios", dev: true, minify: false, out: "bundle.js" });
})().catch((e) => {
  console.error(e && e.message);
  process.exit(1);
});
`,
  "index.js": `import { Card } from "lucent:views/card";
import * as direct from "./src/card.lucent";

console.log(Card === direct.Card);
`,
};

/** The app's tsconfig, as `lucent init` leaves a React Native app's. */
const TSCONFIG = withLucentTsconfig(
  JSON.stringify(
    {
      extends: "@react-native/typescript-config",
      include: ["*.tsx"],
      compilerOptions: { types: ["react"] },
    },
    null,
    2,
  ),
)!;

/** TypeScript's errors in `file` of the app at `root`, as `CODE line: message`. */
function typeErrors(root: string, file: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(root, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  )!;
  const program = ts.createProgram(config.fileNames, config.options);
  const source = program.getSourceFile(path.join(root, file))!;

  return [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ].map(
    (d) =>
      `TS${d.code} ${source.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
  );
}

describe("a component imported as lucent:views/<module>", () => {
  it.skipIf(!sdkAvailable("ios") || !sdkAvailable("android") || !fs.existsSync(metro))(
    "is typed by tsc as React's, and bundled by Metro as the component's module, once",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-component-types-"));

      for (const [file, text] of Object.entries({ ...APP, "tsconfig.json": TSCONFIG })) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      }
      fs.symlinkSync(path.join(workspace, "node_modules"), path.join(root, "node_modules"));

      const built = runLucent(["build", "--root", root], {
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 600_000,
      });

      expect(built.status, built.stdout + built.stderr).toBe(0);

      // Typed by the declarations lucent build writes, through the lucent:* path.
      expect(typeErrors(root, "App.tsx")).toEqual([]);
      expect(typeErrors(root, "Wrong.tsx")).toEqual([
        expect.stringMatching(/^TS2322 4: Type 'number' is not assignable to type 'string'/),
      ]);

      const bundled = runToExit(process.execPath, ["bundle.cjs"], {
        cwd: root,
        env: { ...process.env, LUCENT_WATCH: "0" },
        timeout: 600_000,
      });

      expect(bundled.status, bundled.stdout + bundled.stderr).toBe(0);

      // A dev bundle ends each module with its id, its dependencies' ids and its path.
      const modules = [
        ...fs
          .readFileSync(path.join(root, "bundle.js"), "utf8")
          .matchAll(/\},(\d+),\[([\d,]*)\],"([^"]+)"\);/g),
      ].map(([, id, deps, name]) => ({ id, deps: deps!.split(",").filter(Boolean), name: name! }));
      const card = modules.filter((m) => m.name === "src/card.lucent.ts");
      const forwarder = modules.find((m) => m.name.endsWith("_lucent/components/card.js"));

      expect(card).toHaveLength(1);
      expect(forwarder?.deps).toEqual([card[0]!.id]);
    },
    1_200_000,
  );
});

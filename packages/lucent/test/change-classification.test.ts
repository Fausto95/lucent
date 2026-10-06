import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { buildProject } from "../src/cli/pipeline.ts";
import { plainSteps } from "../src/cli/ui/steps.ts";
import { createTheme } from "../src/cli/ui/theme.ts";
import { type DevState, startSession } from "../src/cli/dev/session.ts";
import { runLucent } from "./run-to-exit.ts";

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

/**
 * A workspace: an app, and a Lucent package outside it that the app links
 * (node_modules/lucent-orbit → ../../packages/lucent-orbit), with a resource.
 */
function workspace() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-changes-")));
  const app = path.join(work, "app");
  const pkg = path.join(work, "packages/lucent-orbit");

  write(app, {
    "package.json": JSON.stringify({ name: "app", dependencies: { "lucent-orbit": "1.0.0" } }),
    "a.lucent.ts": "export function one(): number { return 1; }\n",
    "App.tsx": "export const App = () => null;\n",
  });

  write(pkg, {
    "package.json": JSON.stringify({
      name: "lucent-orbit",
      version: "1.0.0",
      lucent: { sources: "src" },
    }),
    "lucent.json": JSON.stringify({
      ios: { resources: ["assets/chime.caf"] },
      android: { assets: ["assets/android"] },
    }),
    "src/orbit.lucent.ts": "export function orbit(): number { return 1; }\n",
    "assets/chime.caf": "caf",
    "assets/android/chime.ogg": "ogg",
    "README.md": "# lucent-orbit\n",
  });

  fs.mkdirSync(path.join(app, "node_modules"));
  fs.symlinkSync(pkg, path.join(app, "node_modules/lucent-orbit"));

  return { app, pkg };
}

interface BuildJson {
  ok: boolean;
  upToDate: boolean;
  actions: { kind: string; targets: string[]; files: string[] }[];
}

function build(root: string, ...args: string[]): BuildJson {
  const r = runLucent(["build", "--json", ...args, "--root", root], {
    env: { ...process.env, NO_COLOR: "1" },
  });

  return JSON.parse(r.stdout) as BuildJson;
}

const mtime = (file: string) => fs.statSync(file).mtimeMs;

describe("lucent build's pending actions", () => {
  it("asks for nothing after a JavaScript-only edit: Metro refreshes it", () => {
    const { app } = workspace();
    build(app);

    fs.appendFileSync(path.join(app, "App.tsx"), "export const two = 2;\n");
    const r = build(app);

    expect(r.upToDate).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it("recompiles native code for a body edit, leaving other generated files as they were", () => {
    const { app } = workspace();
    build(app);

    const proxy = path.join(app, ".lucent/native/js/a.js");
    const runtime = path.join(app, ".lucent/native/cpp/lucent/lucent.h");
    const before = { proxy: mtime(proxy), runtime: mtime(runtime) };

    fs.writeFileSync(
      path.join(app, "a.lucent.ts"),
      "export function one(): number { return 2; }\n",
    );
    const r = build(app);

    expect(r.actions).toEqual([
      {
        kind: "compile-native",
        targets: ["ios", "android"],
        files: ["cpp/generated/lucent_identity.cpp", "cpp/generated/m_a.cpp"],
      },
    ]);
    expect({ proxy: mtime(proxy), runtime: mtime(runtime) }).toEqual(before);
  });

  it("regenerates the proxy for a signature edit, and recompiles", () => {
    const { app } = workspace();
    build(app);

    fs.writeFileSync(
      path.join(app, "a.lucent.ts"),
      "export function one(): number { return 1; }\nexport function two(): number { return 2; }\n",
    );
    const r = build(app);

    expect(r.actions.map((a) => a.kind)).toEqual(["compile-native", "reload-js"]);
    expect(r.actions[1]).toEqual({
      kind: "reload-js",
      targets: ["ios", "android"],
      files: ["js/a.js"],
    });
  });

  it("repackages for an edit to a linked package's resource, outside the app", () => {
    const { app, pkg } = workspace();
    build(app);

    fs.writeFileSync(path.join(pkg, "assets/chime.caf"), "louder");
    const r = build(app);

    expect(r.actions).toEqual([
      {
        kind: "repackage",
        targets: ["ios"],
        files: ["packages/lucent-orbit/assets/chime.caf"],
      },
    ]);
  });

  it("says what the app needs in its output, and records it", () => {
    const { app, pkg } = workspace();
    build(app);

    fs.writeFileSync(path.join(pkg, "assets/android/chime.ogg"), "louder");
    const r = runLucent(["build", "--root", app], { env: { ...process.env, NO_COLOR: "1" } });

    expect(r.stdout).toMatch(
      /\nactions +repackage resources +android +packages\/lucent-orbit\/assets\/android\/chime\.ogg\n/,
    );

    const record = JSON.parse(fs.readFileSync(path.join(app, ".lucent/build-record.json"), "utf8"));
    expect(record.pendingActions).toEqual([
      {
        kind: "repackage",
        targets: ["android"],
        files: ["packages/lucent-orbit/assets/android/chime.ogg"],
      },
    ]);
  });

  it("builds again when the linked package's package.json changes resolution, asking nothing when the native package is unchanged", () => {
    const { app, pkg } = workspace();
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
    const exportsMap = (exports: Record<string, string>) =>
      write(pkg, { "package.json": JSON.stringify({ ...manifest, exports }) });

    write(app, {
      "b.lucent.ts":
        'import { orbit } from "lucent-orbit/src/orbit.lucent";\nexport function two(): number { return orbit() + 1; }\n',
    });
    build(app);

    // The import still resolves, to the same module: the build checks again, and writes
    // the same native package.
    exportsMap({ ".": "./index.ts", "./src/*": "./src/*.ts" });
    expect(build(app)).toMatchObject({ ok: true, upToDate: false, actions: [] });

    // It no longer does.
    exportsMap({ ".": "./index.ts" });
    expect(build(app).ok).toBe(false);
  });
});

describe("a superseded build", () => {
  it("publishes nothing once a newer change makes its analysis stale", async () => {
    const { app } = workspace();
    const theme = createTheme({
      color: false,
      interactive: false,
      unicode: true,
      links: false,
      width: 80,
    });

    const stale = new AbortController();
    stale.abort();

    const r = await buildProject(
      app,
      { mode: "build", signal: stale.signal },
      plainSteps(() => {}, theme),
      () => {},
    );

    expect(r.superseded).toBe(true);
    expect(fs.existsSync(path.join(app, ".lucent/native/js/a.js"))).toBe(false);
  });
});

/** A dev session, and the builds it finished. */
function session(root: string) {
  const s = startSession(root);
  const builds: NonNullable<DevState["lastBuild"]>[] = [];

  s.store.subscribe(() => {
    const last = s.store.get().lastBuild;
    if (last && last !== builds.at(-1)) builds.push(last);
  });

  const until = async (count: number, timeout = 30_000) => {
    for (const start = Date.now(); builds.length < count;) {
      if (Date.now() - start > timeout) throw new Error(`${builds.length} builds, not ${count}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  return { s, builds, until };
}

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

/**
 * Until no build has started for `ms`: on a busy machine a file written
 * in the tick the first build started may rightly be rebuilt for once.
 */
async function quiet(builds: readonly unknown[], ms = 800, timeout = 30_000): Promise<number> {
  for (const start = Date.now(); Date.now() - start < timeout;) {
    const before = builds.length;
    await settle(ms);
    if (builds.length === before) return before;
  }

  throw new Error(`still building after ${timeout} ms`);
}

describe("lucent dev's watch", () => {
  it("rebuilds for edits in a linked package outside the app: its modules and native files", async () => {
    const { app, pkg } = workspace();
    const { s, builds, until } = session(app);

    try {
      await until(1);
      expect(s.store.get().watching).toContain(path.relative(app, pkg));

      fs.writeFileSync(path.join(pkg, "assets/chime.caf"), "louder");
      await until(2);
      expect(builds[1]!.actions).toEqual([
        { kind: "repackage", targets: ["ios"], files: ["packages/lucent-orbit/assets/chime.caf"] },
      ]);

      fs.writeFileSync(
        path.join(pkg, "src/orbit.lucent.ts"),
        "export function orbit(): number { return 2; }\n",
      );
      await until(3);
      expect(builds[2]!.actions?.map((a) => a.kind)).toEqual(["compile-native"]);
    } finally {
      s.stop();
    }
  }, 60_000);

  it("does not rebuild for what builds write, or for files no build reads", async () => {
    const { app, pkg } = workspace();
    const { s, builds, until } = session(app);

    try {
      await until(1);
      const settled = await quiet(builds);

      write(app, {
        ".lucent/native/js/extra.js": "// written by a build\n",
        "android/app/build/outputs/app.apk": "apk",
        "App.tsx": "export const App = () => 1;\n",
        "node_modules/left-pad/index.js": "module.exports = () => {};\n",
      });
      fs.appendFileSync(path.join(pkg, "README.md"), "more\n");
      await settle();

      expect(builds).toHaveLength(settled);
    } finally {
      s.stop();
    }
  }, 60_000);

  it("rebuilds when a file the last build read changes: in the app, its node_modules, or outside it", async () => {
    const { app } = workspace();
    const work = path.dirname(app);
    const shapes = (dir: string, width: string) =>
      write(dir, {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", types: "index.d.ts" }),
        "index.d.ts": 'export * from "./shape";\n',
        "shape.d.ts": `export interface Shape { width: ${width} }\n`,
      });

    // Types from a file in the app, and from a package linked from outside it (not a Lucent one).
    shapes(path.join(work, "shapes"), "number");
    fs.symlinkSync(path.join(work, "shapes"), path.join(app, "node_modules/shapes"));
    write(app, {
      "size.ts": "export interface Size { scale: number }\n",
      "a.lucent.ts":
        'import type { Shape } from "shapes";\nimport type { Size } from "./size";\nexport function area(s: Shape, z: Size): number { return s.width * z.scale; }\n',
    });

    const { s, builds, until } = session(app);
    const failing = () => s.store.get().problems.some((p) => p.code === "LUCENT9001");

    try {
      await until(1);
      expect(builds[0]!.ok).toBe(true);
      let settled = await quiet(builds);

      write(app, { "size.ts": "export interface Size { scale: string }\n" });
      await until(settled + 1, 10_000);
      settled = await quiet(builds);
      expect(failing()).toBe(true);

      write(app, { "size.ts": "export interface Size { scale: number }\n" });
      await until(settled + 1, 10_000);
      settled = await quiet(builds);
      expect(failing()).toBe(false);

      shapes(path.join(work, "shapes"), "string");
      await until(settled + 1, 10_000);
      settled = await quiet(builds);
      expect(failing()).toBe(true);

      // An installed copy replaces the link.
      fs.unlinkSync(path.join(app, "node_modules/shapes"));
      shapes(path.join(app, "node_modules/shapes"), "number");
      await until(settled + 1, 10_000);
      settled = await quiet(builds);
      expect(failing()).toBe(false);

      write(app, { "node_modules/shapes/shape.d.ts": "export interface Shape { width: string }\n" });
      await until(settled + 1, 10_000);
      await quiet(builds);
      expect(failing()).toBe(true);
    } finally {
      s.stop();
    }
  }, 120_000);
});

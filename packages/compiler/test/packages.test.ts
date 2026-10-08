import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  compile,
  currentReads,
  currentRealpaths,
  lucentPackages,
  moduleNameOf,
  projectFiles,
  readsKey,
} from "../src/index.ts";

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** `files` relative to `base`, both as they really are (links followed), sorted. */
function relativeTo(base: string, files: string[]): string[] {
  const real = fs.realpathSync(base);
  return files.map((f) => path.relative(real, fs.realpathSync(f))).sort();
}

/** An app whose node_modules has Lucent packages (a `lucent` field) and others. */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkgs-"));
  write(
    root,
    "package.json",
    JSON.stringify({ name: "app", dependencies: { "lucent-a": "1.0.0", "plain-js": "1.0.0" } }),
  );
  write(root, "src/storage.lucent.ts", "export function where(): string { return 'app'; }\n");
  write(
    root,
    "node_modules/lucent-a/package.json",
    JSON.stringify({
      name: "lucent-a",
      version: "1.0.0",
      lucent: { sources: "src", compatible: "^0.2.0" },
      dependencies: { "lucent-b": "1.0.0" },
    }),
  );
  write(
    root,
    "node_modules/lucent-a/src/storage.lucent.ts",
    "export function where(): string { return 'a'; }\n",
  );
  write(
    root,
    "node_modules/lucent-a/src/nested/deep.lucent.ts",
    "export function depth(): number { return 2; }\n",
  );
  write(
    root,
    "node_modules/lucent-b/package.json",
    JSON.stringify({ name: "lucent-b", version: "2.0.0", lucent: { sources: "lib" } }),
  );
  write(
    root,
    "node_modules/lucent-b/lib/storage.lucent.ts",
    "export function where(): string { return 'b'; }\n",
  );
  write(
    root,
    "node_modules/plain-js/package.json",
    JSON.stringify({ name: "plain-js", version: "1.0.0" }),
  );
  write(
    root,
    "node_modules/plain-js/index.lucent.ts",
    "export function never(): number { return 0; }\n",
  );
  return root;
}

describe("Lucent packages", () => {
  it("names a package's modules <package>/<module>, and the app's by their file", () => {
    const root = app();
    expect(moduleNameOf(path.join(root, "src/storage.lucent.ts"))).toBe("storage");
    expect(moduleNameOf(path.join(root, "node_modules/lucent-a/src/storage.lucent.ts"))).toBe(
      "lucent-a/storage",
    );
    expect(moduleNameOf(path.join(root, "node_modules/lucent-a/src/nested/deep.lucent.ts"))).toBe(
      "lucent-a/nested/deep",
    );
    expect(moduleNameOf(path.join(root, "node_modules/lucent-b/lib/storage.lucent.ts"))).toBe(
      "lucent-b/storage",
    );
  });

  it("finds the Lucent packages the app depends on, transitively, and nothing else", () => {
    const root = app();
    expect(lucentPackages(root).map((p) => `${p.name}@${p.version}`)).toEqual([
      "lucent-a@1.0.0",
      "lucent-b@2.0.0",
    ]);
    // Packages are where they really are (workspace links followed).
    const real = fs.realpathSync(root);
    expect(projectFiles(root).map((f) => path.relative(real, fs.realpathSync(f)))).toEqual([
      "node_modules/lucent-a/src/nested/deep.lucent.ts",
      "node_modules/lucent-a/src/storage.lucent.ts",
      "node_modules/lucent-b/lib/storage.lucent.ts",
      "src/storage.lucent.ts",
    ]);
  });

  it("compiles modules of the same name from different packages side by side", () => {
    const root = app();
    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    expect([...r.proxies.keys()].sort()).toEqual([
      "lucent-a/nested/deep",
      "lucent-a/storage",
      "lucent-b/storage",
      "storage",
    ]);
    expect(r.proxies.get("lucent-a/storage")).toContain('loadModule("lucent-a/storage"');
    const headers = [...r.files.keys()].filter((f) => f.endsWith(".h") && f !== "lucent_app.h");
    expect(new Set(headers).size).toBe(4);
  });

  it("lets Lucent modules import other packages' modules by path", () => {
    const root = app();
    fs.writeFileSync(
      path.join(root, "src/uses.lucent.ts"),
      'import { where } from "lucent-a/src/storage.lucent";\nimport { depth } from "lucent-a/src/nested/deep.lucent";\nexport function both(): string { return `${where()} ${depth()}`; }\n',
    );
    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    const uses = [...r.files.entries()].find(([k]) => k.endsWith("m_uses.cpp"))?.[1] ?? "";
    expect(uses).toMatch(/lucent_app::m_lucent_\w*storage::where\(\)/);
  });

  it("leaves lucent.json to the build: an invalid one does not stop finding packages", () => {
    const root = app();
    fs.writeFileSync(path.join(root, "node_modules/lucent-b/lucent.json"), "{ not json");

    expect(lucentPackages(root).map((p) => p.name)).toEqual(["lucent-a", "lucent-b"]);
    expect(projectFiles(root)).toHaveLength(4);
  });

  it("reports a package whose Lucent versions do not include this one, at its package.json", () => {
    const root = app();
    const pkg = path.join(root, "node_modules/lucent-b/package.json");
    fs.writeFileSync(
      pkg,
      JSON.stringify({
        name: "lucent-b",
        version: "2.0.0",
        lucent: { sources: "lib", compatible: "^9.0.0" },
      }),
    );
    // Found: the build reports it, and the rest of the app still resolves.
    expect(lucentPackages(root).map((p) => p.name)).toEqual(["lucent-a", "lucent-b"]);

    const r = compile(projectFiles(root));
    expect(r.ok).toBe(false);
    const [d] = r.diagnostics.filter((d) => d.code === "LUCENT3014");
    expect(d?.message).toMatch(/lucent-b@2\.0\.0 supports Lucent \^9\.0\.0, not \d+\.\d+\.\d+/);
    expect(d?.file && fs.realpathSync(d.file)).toBe(fs.realpathSync(pkg));
  });

  it("compiles it anyway with LUCENT_IGNORE_COMPATIBLE=1, warning", () => {
    const root = app();
    fs.writeFileSync(
      path.join(root, "node_modules/lucent-b/package.json"),
      JSON.stringify({
        name: "lucent-b",
        version: "2.0.0",
        lucent: { sources: "lib", compatible: "^9.0.0" },
      }),
    );
    process.env.LUCENT_IGNORE_COMPATIBLE = "1";
    try {
      const r = compile(projectFiles(root));
      expect(r.diagnostics).toEqual([]);
      expect(r.warnings?.map((w) => [w.code, w.severity])).toEqual([["LUCENT3014", "warning"]]);
    } finally {
      delete process.env.LUCENT_IGNORE_COMPATIBLE;
    }
  });
});

describe("what a compile reads", () => {
  /** app(), with a module that imports a package's module by path, and types from a plain TypeScript file. */
  function importing(): string {
    // Its real path: the temporary directory is behind a link on macOS.
    const root = fs.realpathSync(app());
    fs.writeFileSync(
      path.join(root, "src/uses.lucent.ts"),
      'import { where } from "lucent-a/src/storage.lucent";\nimport type { Place } from "./place";\nexport function here(p: Place): string { return `${where()} ${p.name}`; }\n',
    );
    fs.writeFileSync(path.join(root, "src/place.ts"), "export interface Place { name: string }\n");
    return root;
  }

  it("reports the files it read: the package.json files resolution and package lookups read, and the files types come from", () => {
    const root = importing();
    const r = compile(projectFiles(root));

    expect(r.diagnostics).toEqual([]);
    expect([...r.read.keys()].map((f) => path.relative(root, f))).toEqual(
      expect.arrayContaining([
        "package.json",
        "node_modules/lucent-a/package.json",
        "src/place.ts",
        // Looked for, and missing: the nearest package.json names the app's modules.
        "src/package.json",
      ]),
    );
  });

  it("keys the files it read the same while they are as it read them, and apart once one changes", () => {
    const root = importing();
    // TypeScript reads past a byte order mark.
    fs.writeFileSync(
      path.join(root, "src/place.ts"),
      "\uFEFFexport interface Place { name: string }\n",
    );
    const { read } = compile(projectFiles(root));

    expect(readsKey(currentReads(read.keys()))).toBe(readsKey(read));

    // A package.json where there was none.
    fs.writeFileSync(path.join(root, "src/package.json"), JSON.stringify({ name: "nested" }));
    expect(readsKey(currentReads(read.keys()))).not.toBe(readsKey(read));
  });

  it("reports where the links resolution followed led, apart from the files it read", () => {
    const root = importing();
    const linked = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-place-")));
    fs.writeFileSync(path.join(linked, "package.json"), JSON.stringify({ name: "place" }));
    fs.writeFileSync(path.join(linked, "index.d.ts"), "export interface Place { name: string }\n");
    fs.symlinkSync(linked, path.join(root, "node_modules/place"));
    fs.writeFileSync(path.join(root, "src/place.ts"), 'export type { Place } from "place";\n');

    const { diagnostics, read, realpaths } = compile(projectFiles(root));
    const link = path.join(root, "node_modules/place/index.d.ts");

    expect(diagnostics).toEqual([]);
    expect(realpaths.get(link)).toBe(path.join(linked, "index.d.ts"));
    expect(read.has(path.join(linked, "index.d.ts"))).toBe(true);
    expect(readsKey(currentRealpaths(realpaths.keys()))).toBe(readsKey(realpaths));

    // An installed copy, the same file by file: only where the link led changes.
    fs.unlinkSync(path.join(root, "node_modules/place"));
    fs.cpSync(linked, path.join(root, "node_modules/place"), { recursive: true });
    expect(readsKey(currentReads(read.keys()))).toBe(readsKey(read));
    expect(currentRealpaths([link]).get(link)).toBe(link);
  });
});

describe("Lucent packages inside the project's directory", () => {
  const near = {
    name: "lucent-near",
    version: "1.0.0",
    lucent: { sources: "src" },
  };

  it("compiles a Lucent package inside the app once, as the package, when the app depends on it", () => {
    const root = app();
    write(root, "packages/lucent-near/package.json", JSON.stringify(near));
    write(
      root,
      "packages/lucent-near/src/near.lucent.ts",
      "export function near(): number { return 1; }\n",
    );
    write(
      root,
      "package.json",
      JSON.stringify({
        name: "app",
        dependencies: {
          "lucent-a": "1.0.0",
          "plain-js": "1.0.0",
          "lucent-near": "file:packages/lucent-near",
        },
      }),
    );
    fs.symlinkSync(
      path.join(root, "packages/lucent-near"),
      path.join(root, "node_modules/lucent-near"),
    );

    expect(relativeTo(root, projectFiles(root))).toEqual([
      "node_modules/lucent-a/src/nested/deep.lucent.ts",
      "node_modules/lucent-a/src/storage.lucent.ts",
      "node_modules/lucent-b/lib/storage.lucent.ts",
      "packages/lucent-near/src/near.lucent.ts",
      "src/storage.lucent.ts",
    ]);

    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    expect([...r.proxies.keys()]).toContain("lucent-near/near");
  });

  it("leaves out a Lucent package inside the app that the app does not depend on", () => {
    const root = app();
    write(
      root,
      "packages/lucent-far/package.json",
      JSON.stringify({ ...near, name: "lucent-far" }),
    );
    write(
      root,
      "packages/lucent-far/src/far.lucent.ts",
      "export function far(): number { return 2; }\n",
    );

    expect(relativeTo(root, projectFiles(root))).toEqual([
      "node_modules/lucent-a/src/nested/deep.lucent.ts",
      "node_modules/lucent-a/src/storage.lucent.ts",
      "node_modules/lucent-b/lib/storage.lucent.ts",
      "src/storage.lucent.ts",
    ]);
  });

  it("tells an app importing a Lucent package it does not depend on to depend on it", () => {
    const root = app();
    write(
      root,
      "packages/lucent-far/package.json",
      JSON.stringify({ ...near, name: "lucent-far" }),
    );
    write(
      root,
      "packages/lucent-far/src/far.lucent.ts",
      "export function far(): number { return 2; }\n",
    );
    write(
      root,
      "src/uses-far.lucent.ts",
      'import { far } from "../packages/lucent-far/src/far.lucent";\nexport function twice(): number { return far() * 2; }\n',
    );

    expect(compile(projectFiles(root)).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LUCENT3001",
        message: expect.stringMatching(/lucent-far, a Lucent package the app does not depend on/),
        fix: expect.stringMatching(/add lucent-far to the app's dependencies/),
      }),
    );
  });

  it("says an imported Lucent file outside the app's modules is not compiled with it", () => {
    const root = app();
    write(
      root,
      "src/uses-plain.lucent.ts",
      'import { never } from "../node_modules/plain-js/index.lucent";\nexport function zero(): number { return never(); }\n',
    );

    expect(compile(projectFiles(root)).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LUCENT3001",
        message: expect.stringMatching(/is not among the modules compiled with the app/),
      }),
    );
  });

  it("walks a Lucent package inside another package's sources only as itself", () => {
    const root = app();
    const vendored = "node_modules/lucent-a/src/vendor/lucent-c";
    write(
      root,
      `${vendored}/package.json`,
      JSON.stringify({ name: "lucent-c", version: "1.0.0", lucent: { sources: "." } }),
    );
    write(root, `${vendored}/far.lucent.ts`, "export function far(): number { return 3; }\n");
    write(
      root,
      "node_modules/lucent-a/package.json",
      JSON.stringify({
        name: "lucent-a",
        version: "1.0.0",
        lucent: { sources: "src", compatible: "^0.2.0" },
        dependencies: { "lucent-b": "1.0.0", "lucent-c": "1.0.0" },
      }),
    );
    fs.mkdirSync(path.join(root, "node_modules/lucent-a/node_modules"));
    fs.symlinkSync(
      path.join(root, vendored),
      path.join(root, "node_modules/lucent-a/node_modules/lucent-c"),
    );

    const far = `${vendored}/far.lucent.ts`;
    expect(relativeTo(root, projectFiles(root)).filter((f) => f === far)).toEqual([far]);

    const r = compile(projectFiles(root));
    expect(r.diagnostics).toEqual([]);
    expect([...r.proxies.keys()]).toContain("lucent-c/far");
  });

  it("leaves an app inside a Lucent package to itself, and the package to its own modules", () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkgs-"));
    write(
      lib,
      "package.json",
      JSON.stringify({ name: "lucent-lib", version: "1.0.0", lucent: {} }),
    );
    write(lib, "lib.lucent.ts", "export function answer(): number { return 42; }\n");
    write(
      lib,
      "example/package.json",
      JSON.stringify({ name: "example", dependencies: { "lucent-lib": "1.0.0" } }),
    );
    write(lib, "example/src/demo.lucent.ts", "export function demo(): string { return 'demo'; }\n");
    fs.mkdirSync(path.join(lib, "example/node_modules"));
    fs.symlinkSync(lib, path.join(lib, "example/node_modules/lucent-lib"));
    const example = path.join(lib, "example");

    expect(relativeTo(lib, projectFiles(example))).toEqual([
      "example/src/demo.lucent.ts",
      "lib.lucent.ts",
    ]);
    expect(compile(projectFiles(example)).diagnostics).toEqual([]);

    // The package's author checks it from its own directory.
    expect(relativeTo(lib, projectFiles(lib))).toEqual(["lib.lucent.ts"]);
  });

  it("walks a folder with a package.json that is not a Lucent package's as the app's", () => {
    const root = app();
    write(root, "src/legacy/package.json", JSON.stringify({ type: "module" }));
    write(root, "src/legacy/old.lucent.ts", "export function old(): number { return 4; }\n");

    expect(relativeTo(root, projectFiles(root))).toContain("src/legacy/old.lucent.ts");
    expect(moduleNameOf(path.join(root, "src/legacy/old.lucent.ts"))).toBe("old");
  });

  it("walks a Lucent package's folder whose package.json only sets the module type as the package's", () => {
    const root = app();
    write(root, "node_modules/lucent-a/src/geo/package.json", JSON.stringify({ type: "module" }));
    const distance = "node_modules/lucent-a/src/geo/distance.lucent.ts";
    write(root, distance, "export function distance(): number { return 5; }\n");

    expect(relativeTo(root, projectFiles(root))).toContain(distance);
    expect(moduleNameOf(path.join(root, distance))).toBe("lucent-a/geo/distance");
  });

  it("leaves an app with dependencies but no name inside a Lucent package to itself", () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-pkgs-"));
    write(
      lib,
      "package.json",
      JSON.stringify({ name: "lucent-lib", version: "1.0.0", lucent: {} }),
    );
    write(lib, "lib.lucent.ts", "export function answer(): number { return 42; }\n");
    write(lib, "example/package.json", JSON.stringify({ dependencies: { "lucent-lib": "1.0.0" } }));
    write(lib, "example/src/demo.lucent.ts", "export function demo(): string { return 'demo'; }\n");

    expect(relativeTo(lib, projectFiles(lib))).toEqual(["lib.lucent.ts"]);
    expect(moduleNameOf(path.join(lib, "example/src/demo.lucent.ts"))).toBe("demo");
  });
});

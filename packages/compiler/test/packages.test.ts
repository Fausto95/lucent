import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, lucentPackages, moduleNameOf, projectFiles } from "../src/index.ts";

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
      lucent: { sources: "src", compatible: ">=0.0.3" },
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

  it("fails for a package whose Lucent versions do not include this one, naming it", () => {
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
    expect(() => lucentPackages(root)).toThrow(
      /lucent-b@2\.0\.0 supports Lucent \^9\.0\.0, not \d+\.\d+\.\d+/,
    );
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
        lucent: { sources: "src", compatible: ">=0.0.3" },
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
});

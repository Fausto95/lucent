import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { BuildRecord } from "../src/cli/build-graph.ts";
import { runLucent } from "./run-to-exit.ts";

const fixture = path.resolve(import.meta.dirname, "../../compiler/test/fixtures/orbit-filter");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

/** An app that depends on the fixture extension package and uses it from its own module. */
function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-app-"));

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "app", dependencies: { "lucent-orbit-filter": "1.0.0" } }),
  );
  fs.cpSync(fixture, path.join(root, "node_modules/lucent-orbit-filter"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src/brighten.lucent.ts"),
    'import { Filter } from "lucent-orbit-filter/src/filter.lucent";\nexport function brighten(bytes: Uint8Array): Uint8Array {\n  const f = new Filter(2);\n  try {\n    return f.apply(bytes);\n  } finally {\n    f.close();\n  }\n}\n',
  );

  return root;
}

/** A host build: no platform SDK or Gradle needed, the same native package files. */
function build(root: string) {
  const r = runLucent(["build", "--platforms", "host", "--root", root], {
    env: { ...process.env, NO_COLOR: "1" },
  });

  return { status: r.status, out: r.stdout + r.stderr };
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe.skipIf(!clang)("building an app with a package's native extension", () => {
  it("compiles the extension into the one native package", () => {
    const root = app();

    const r = build(root);
    expect(r.out).not.toMatch(/error|✗/i);
    expect(r.status).toBe(0);

    const native = path.join(root, ".lucent/native");

    // The adapter's sources and header are the package's native sources, built by both platforms.
    expect(
      fs.existsSync(path.join(native, "packages/lucent-orbit-filter/native/orbit_filter.cpp")),
    ).toBe(true);
    expect(read(native, "LucentNative.podspec")).toContain("packages/lucent-orbit-filter/native");
    expect(read(native, "android/packages.cmake")).toContain("packages/lucent-orbit-filter/native");

    // The package's module calls it; the declarations are there for editors and tsc.
    const generated = fs
      .readdirSync(path.join(native, "cpp/generated"), { recursive: true })
      .map(String)
      .filter((f) => f.includes("orbit") && f.endsWith(".cpp"))
      .map((f) => read(native, `cpp/generated/${f}`))
      .join("\n");
    expect(generated).toContain('#include "orbit_filter.h"');
    expect(generated).toContain("orbit_filter_apply(");
    expect(read(native, "types/ext/orbit-filter.d.ts")).toContain(
      "export declare class OrbitFilter",
    );

    // The resolved manifest records it; the build record reads its header.
    const resolved = JSON.parse(read(native, "resolved.json"));
    expect(resolved.extensions["orbit-filter"]).toMatchObject({
      package: "lucent-orbit-filter",
      header: { path: "native/orbit_filter.h" },
    });
    const record = JSON.parse(read(root, ".lucent/build-record.json")) as BuildRecord;
    expect(record.nodes.find((n) => n.id === "extract:extensions")).toMatchObject({
      status: "ok",
      inputs: [{ key: "ext/orbit-filter" }],
    });
  });

  it("fails, naming the package and the field, when the declaration contradicts the header", () => {
    const root = app();
    const file = path.join(root, "node_modules/lucent-orbit-filter/lucent.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.extensions["orbit-filter"].handles.OrbitFilter.destroy = "orbit_filter_free";
    fs.writeFileSync(file, JSON.stringify(json));

    const r = build(root);

    expect(r.status).not.toBe(0);
    expect(r.out).toContain(
      "lucent-orbit-filter/lucent.json: extensions.orbit-filter.handles.OrbitFilter.destroy: orbit_filter.h declares no function orbit_filter_free",
    );
  });
});

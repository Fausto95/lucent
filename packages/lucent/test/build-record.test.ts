import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import {
  BuildGraph,
  type BuildRecord,
  requiredAction,
  writeBuildRecord,
} from "../src/cli/build-graph.ts";
import { runLucent } from "./run-to-exit.ts";

function lucent(
  root: string,
  command: "build" | "check",
  platforms = "host",
  { env = {}, cwd }: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  // A host build: no platform SDK or Gradle needed. check takes no targets.
  const targets = command === "build" ? ["--platforms", platforms] : [];

  const r = runLucent([command, ...targets, "--root", root], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...env },
  });

  return { status: r.status, out: r.stdout + r.stderr };
}

function project(source = "export function one(): number { return 1; }\n"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-record-"));
  fs.writeFileSync(path.join(root, "a.lucent.ts"), source);

  return root;
}

function record(root: string): BuildRecord {
  return JSON.parse(fs.readFileSync(path.join(root, ".lucent/build-record.json"), "utf8"));
}

function node(r: BuildRecord, id: string) {
  return r.nodes.find((n) => n.id === id);
}

describe("the build graph", () => {
  it("hashes a node's kind, inputs and outputs, whatever their order, and not its timing", () => {
    const a = new BuildGraph("build");
    const b = new BuildGraph("build");

    const x = a.record("check", "check", "ok", {
      inputs: [
        { key: "b.lucent.ts", hash: "2" },
        { key: "a.lucent.ts", hash: "1" },
      ],
      ms: 12,
    });
    const y = b.record("check", "check", "ok", {
      inputs: [
        { key: "a.lucent.ts", hash: "1" },
        { key: "b.lucent.ts", hash: "2" },
      ],
      ms: 99,
    });

    expect(x.hash).toBe(y.hash);
    expect(x.inputs.map((i) => i.key)).toEqual(["a.lucent.ts", "b.lucent.ts"]);
    expect(a.toRecord({ kind: "none" }).timings).toEqual({ check: 12 });
  });

  it("changes a node's hash when an input's content changes", () => {
    const g = new BuildGraph("build");

    const before = g.record("one", "check", "ok", { inputs: [{ key: "a", hash: "1" }] });
    const after = g.record("two", "check", "ok", { inputs: [{ key: "a", hash: "2" }] });

    expect(before.hash).not.toBe(after.hash);
  });

  it("rejects a node recorded twice", () => {
    const g = new BuildGraph("check");
    g.record("check", "check", "ok");

    expect(() => g.record("check", "check", "failed")).toThrow(/recorded twice/);
  });

  it("derives the required action from what changed", () => {
    const none = { rebuild: false, podInstall: false, reload: false };

    expect(requiredAction(none, ["ios"], [])).toEqual({ kind: "none" });
    expect(requiredAction({ ...none, reload: true }, ["ios"], [])).toEqual({ kind: "reload-js" });

    expect(requiredAction({ ...none, rebuild: true }, ["ios"], ["b.cpp", "a.cpp"])).toEqual({
      kind: "compile-native",
      targets: ["ios"],
      changedUnits: ["a.cpp", "b.cpp"],
    });

    expect(
      requiredAction({ rebuild: true, podInstall: true, reload: false }, ["ios"], []),
    ).toMatchObject({ kind: "relink", targets: ["ios"] });

    // What the relink is for: the files that need it, a package's pods among them.
    expect(
      requiredAction(
        { rebuild: true, podInstall: true, reload: false },
        ["ios"],
        [],
        [{ kind: "relink", targets: ["ios"], files: ["resolved.json#ios.pods"] }],
      ),
    ).toEqual({ kind: "relink", targets: ["ios"], dependencyChanges: ["resolved.json#ios.pods"] });
  });

  it("writes the record whole, leaving no temporary file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-record-"));
    const file = path.join(dir, "nested/build-record.json");

    writeBuildRecord(file, new BuildGraph("build").toRecord({ kind: "none" }));

    expect(fs.readdirSync(path.dirname(file))).toEqual(["build-record.json"]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion).toBe(1);
  });
  it("keeps the record before it, for doctor to say what a step ran again for", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-record-previous-"));
    const file = path.join(dir, "build-record.json");
    const first = new BuildGraph("build");
    first.record("check", "check", "ok", { inputs: [{ key: "a.lucent.ts", hash: "1" }] });
    const second = new BuildGraph("build");
    second.record("check", "check", "cached", { inputs: [{ key: "a.lucent.ts", hash: "1" }] });

    writeBuildRecord(file, first.toRecord({ kind: "none" }));
    expect(fs.existsSync(path.join(dir, "build-record.previous.json"))).toBe(false);

    writeBuildRecord(file, second.toRecord({ kind: "none" }));
    const previous = JSON.parse(
      fs.readFileSync(path.join(dir, "build-record.previous.json"), "utf8"),
    ) as BuildRecord;
    expect(previous.nodes[0]!.status).toBe("ok");
    expect((JSON.parse(fs.readFileSync(file, "utf8")) as BuildRecord).nodes[0]!.status).toBe(
      "cached",
    );
  });
});

describe("lucent build's record", () => {
  it("records the check and the generated files, with project-relative paths", () => {
    const root = project();

    expect(lucent(root, "build").status).toBe(0);

    const r = record(root);
    expect(r.mode).toBe("build");

    const check = node(r, "check")!;
    expect(check).toMatchObject({ kind: "check", status: "ok" });
    // The files it read besides: the package.json naming the module (none here), and
    // those outside the project, the compiler's own, by what they hold.
    expect(check.inputs.map((i) => i.key)).toEqual([
      "a.lucent.ts",
      "outside-project",
      "package.json",
      "targets",
    ]);

    const generate = node(r, "generate")!;
    expect(generate.status).toBe("ok");
    expect(generate.outputs.length).toBeGreaterThan(0);
    expect(generate.outputs.every((o) => o.key.startsWith(".lucent/native/"))).toBe(true);

    expect(JSON.stringify(r.nodes)).not.toContain(root);
    // A host build: no pod install, which only an iOS target needs.
    expect(r.requiredAction.kind).toBe("compile-native");
    expect(typeof r.timings.check).toBe("number");
  });

  it("records a build with nothing to do as cached, with no action required", () => {
    const root = project();
    lucent(root, "build");

    expect(lucent(root, "build").status).toBe(0);

    const r = record(root);
    expect(node(r, "check")?.status).toBe("cached");
    expect(node(r, "generate")?.status).toBe("cached");
    expect(r.requiredAction).toEqual({ kind: "none" });
  });

  it("records the failed node and nothing after it", () => {
    const root = project("export function one(): number { return 'one'; }\n");

    expect(lucent(root, "build").status).toBe(1);

    const r = record(root);
    expect(node(r, "check")).toMatchObject({ status: "failed", detail: "1 error" });
    expect(node(r, "generate")).toBeUndefined();
    expect(r.requiredAction).toEqual({ kind: "none" });
  });

  it("writes the same nodes for a clean rebuild of the same inputs", () => {
    const root = project();
    lucent(root, "build");
    const first = record(root);

    fs.rmSync(path.join(root, ".lucent"), { recursive: true });
    lucent(root, "build");
    const second = record(root);

    expect(second.nodes).toEqual(first.nodes);
    expect(second.requiredAction).toEqual(first.requiredAction);
  });

  it("writes the same check node for a project wherever it is, and wherever it is built from", () => {
    // An app has its own node_modules.
    const here = project();
    fs.mkdirSync(path.join(here, "node_modules"));
    // The same project, a directory deeper.
    const deeper = path.join(project(), "app");
    fs.cpSync(here, deeper, { recursive: true });

    lucent(here, "build", "host", { cwd: here });
    lucent(deeper, "build");

    expect(node(record(deeper), "check")).toEqual(node(record(here), "check"));
  });

  it("records a check too", () => {
    const root = project();

    expect(lucent(root, "check").status).toBe(0);

    const r = record(root);
    expect(r.mode).toBe("check");
    expect(node(r, "check")?.status).toBe("ok");
    expect(node(r, "generate")).toBeUndefined();
  });
});

describe.skipIf(!sdkAvailable("android"))("lucent build's record: SDK bindings", () => {
  it("records the artifacts each imported module's schema was read from", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, "model.lucent.ts"),
      "export declare function model(): string;\n",
    );
    fs.writeFileSync(
      path.join(root, "model.android.lucent.ts"),
      `import { Build } from "lucent:android/android.os";\n\nexport function model(): string {\n  return Build.MODEL ?? "";\n}\n`,
    );
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-record-cache-"));

    const built = lucent(root, "build", "android", { env: { LUCENT_CACHE_DIR: cache } });
    expect(built.out).not.toMatch(/error/i);

    const extract = node(record(root), "extract")!;
    const hex = expect.stringMatching(/^[0-9a-f]{16}$/);

    // The module, keyed on what its schema read, and the SDK platform it was read from.
    expect(extract.inputs).toEqual([
      { key: expect.stringMatching(/^android-sdk:\d/), hash: hex },
      { key: "android/android.os", hash: hex },
    ]);
    expect(JSON.stringify(extract)).not.toContain(cache);
  });
});

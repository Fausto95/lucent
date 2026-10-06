// lucent build in a workspace (T61): an app depending on a Lucent package
// that depends on another, linked as package managers link workspaces.
// An edit to the transitive one reaches the app's next build; a build that
// fails on it recovers once it is fixed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { BuildRecord } from "../src/cli/build-graph.ts";
import { runLucent } from "./run-to-exit.ts";

/** apps/app → packages/geo → packages/geo-core, each linked from node_modules. */
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-workspace-"));
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const link = (from: string, name: string, to: string) => {
    fs.mkdirSync(path.join(root, from, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(root, to), path.join(root, from, "node_modules", name));
  };

  write(
    "apps/app/package.json",
    JSON.stringify({ name: "app", dependencies: { geo: "workspace:*" } }),
  );
  write("apps/app/src/a.lucent.ts", "export function one(): number { return 1; }\n");
  write(
    "packages/geo/package.json",
    JSON.stringify({
      name: "geo",
      lucent: { sources: "src" },
      dependencies: { "geo-core": "workspace:*" },
    }),
  );
  write("packages/geo/src/geo.lucent.ts", "export function far(): number { return 2; }\n");
  write(
    "packages/geo-core/package.json",
    JSON.stringify({ name: "geo-core", lucent: { sources: "src" } }),
  );
  write("packages/geo-core/src/core.lucent.ts", "export function near(): number { return 3; }\n");
  link("apps/app", "geo", "packages/geo");
  link("packages/geo", "geo-core", "packages/geo-core");

  const app = path.join(root, "apps/app");
  return {
    app,
    edit: (text: string) => write("packages/geo-core/src/core.lucent.ts", text),
    build: () => {
      const r = runLucent(["build", "--platforms", "host", "--root", app], {
        env: { ...process.env, NO_COLOR: "1" },
      });
      return { status: r.status, out: r.stdout + r.stderr };
    },
    record: () =>
      JSON.parse(
        fs.readFileSync(path.join(app, ".lucent/build-record.json"), "utf8"),
      ) as BuildRecord,
    proxy: () => fs.readFileSync(path.join(app, ".lucent/native/js/geo-core/core.js"), "utf8"),
  };
}

const step = (r: BuildRecord, id: string) => r.nodes.find((n) => n.id === id)?.status;

describe("lucent build in a workspace", () => {
  it("builds an edit to a package the app depends on through another", () => {
    const w = workspace();

    expect(w.build()).toMatchObject({ status: 0 });
    expect(w.proxy()).toContain("near");
    expect(w.build()).toMatchObject({ status: 0 });
    expect(step(w.record(), "check")).toBe("cached");

    w.edit(
      "export function near(): number { return 3; }\nexport function nearer(): number { return 4; }\n",
    );

    expect(w.build()).toMatchObject({ status: 0 });
    expect(step(w.record(), "check")).toBe("ok");
    expect(w.proxy()).toContain("nearer");
  });

  it("fails on a broken package module, naming it, and recovers once it is fixed", () => {
    const w = workspace();
    expect(w.build()).toMatchObject({ status: 0 });

    w.edit("export function near(): number {\n  var x = 3;\n  return x;\n}\n");
    const broken = w.build();
    expect(broken.status).toBe(1);
    expect(broken.out).toMatch(/core\.lucent\.ts/);
    expect(broken.out).toContain("LUCENT1001");

    // The failure is not kept: the fixed module builds, and its code is what the app gets.
    w.edit("export function near(): number { return 5; }\n");
    expect(w.build()).toMatchObject({ status: 0 });
    expect(step(w.record(), "check")).toBe("ok");
    expect(w.proxy()).toContain("near");
    expect(w.build()).toMatchObject({ status: 0 });
    expect(step(w.record(), "check")).toBe("cached");
  });
});

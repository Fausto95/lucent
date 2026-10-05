import { describe, expect, it } from "vitest";
import { plan } from "./ci-changes.ts";

const keys = (files: string[] | undefined) => plan(files).harnesses.map((h) => h.key);

describe("ci-changes", () => {
  it("runs everything on a push (no diff)", () => {
    const p = plan(undefined);
    expect(p).toMatchObject({
      runtime: true,
      website: true,
      iosTest: true,
      iosChecks: true,
      apps: true,
    });
    expect(keys(undefined)).toEqual(["e2e", "bench", "app-check-bare", "app-check-expo"]);
  });

  it("runs only the essentials for docs", () => {
    const p = plan(["docs/semantics.md", "ROADMAP.md", ".changeset/x.md"]);
    expect(p).toEqual({
      runtime: false,
      harnesses: [],
      website: false,
      iosTest: false,
      iosChecks: false,
      apps: false,
    });
  });

  it("runs the website alone for the website and the tutorial", () => {
    const p = plan([
      "apps/website/src/content/docs/index.mdx",
      "apps/tutorial/steps/1-start/App.tsx",
    ]);
    expect(p).toMatchObject({ website: true, runtime: false, iosTest: false, apps: false });
    expect(p.harnesses).toEqual([]);
  });

  it("runs the runtime job only for the runtime", () => {
    expect(plan(["packages/compiler/src/ir/lower.ts"]).runtime).toBe(false);
    expect(plan(["packages/runtime/cpp/lucent/value.h"]).runtime).toBe(true);
  });

  it("runs every harness and iOS job for a package change", () => {
    const p = plan(["packages/bindgen/src/index.ts"]);
    expect(p).toMatchObject({ website: true, iosTest: true, iosChecks: true, apps: true });
    expect(keys(["packages/bindgen/src/index.ts"])).toEqual([
      "e2e",
      "bench",
      "app-check-bare",
      "app-check-expo",
    ]);
  });

  it("runs an app's own checks for an app change", () => {
    expect(keys(["apps/expo-example/App.tsx"])).toEqual(["app-check-expo"]);
    expect(plan(["apps/expo-example/App.tsx"]).apps).toBe(false);
    expect(keys(["apps/bare-example/App.tsx"])).toEqual(["app-check-bare"]);
    expect(plan(["apps/bare-example/App.tsx"]).apps).toBe(true);
  });

  it("runs everything for CI and dependency changes", () => {
    for (const f of [".github/workflows/ci.yml", "pnpm-lock.yaml", "vitest.setup-sdk.ts"])
      expect(plan([f])).toEqual(plan(undefined));
  });

  it("runs everything for a file no area places", () => {
    expect(plan(["newdir/thing.ts"])).toEqual(plan(undefined));
    expect(plan(["scripts/views-spike.ts"])).toEqual(plan(undefined));
  });
});

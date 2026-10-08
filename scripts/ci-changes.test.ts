import { describe, expect, it } from "vite-plus/test";
import { plan } from "./ci-changes.ts";

const keys = (files: string[] | undefined) => plan(files).harnesses.map((h) => h.key);

describe("ci-changes", () => {
  it("runs everything on a push (no diff)", () => {
    expect(plan(undefined)).toMatchObject({
      runtime: true,
      website: true,
      iosTest: true,
      iosChecks: true,
      apps: true,
      devices: true,
    });
    expect(keys(undefined)).toEqual(["e2e", "bench", "app-check-bare", "app-check-expo"]);
  });

  it("runs only the unit tests for contributor docs and changesets", () => {
    expect(plan(["docs/semantics.md", ".changeset/x.md", "SECURITY.md"])).toEqual({
      runtime: false,
      harnesses: [],
      website: false,
      iosTest: false,
      iosChecks: false,
      apps: false,
      devices: false,
    });
  });

  it("runs the website for the files its check reads outside apps/website", () => {
    for (const f of ["ROADMAP.md", "README.md", "packages/lucent/CHANGELOG.md"])
      expect(plan([f]).website).toBe(true);
    expect(plan(["ROADMAP.md"]).iosTest).toBe(false);
  });

  it("runs the website alone for the website", () => {
    const p = plan(["apps/website/src/content/docs/index.mdx", "scripts/website/links.ts"]);
    expect(p).toMatchObject({ website: true, runtime: false, iosTest: false, apps: false });
    expect(p.harnesses).toEqual([]);
  });

  it("runs the runtime job only for the runtime", () => {
    expect(plan(["packages/compiler/src/ir/lower.ts"]).runtime).toBe(false);
    expect(plan(["packages/runtime/cpp/lucent/value.h"]).runtime).toBe(true);
  });

  it("runs the device jobs for the runtime and the compiler, not the CLI", () => {
    expect(plan(["packages/runtime/cpp/lucent/value.h"]).devices).toBe(true);
    expect(plan(["packages/compiler/src/ir/lower.ts"]).devices).toBe(true);
    expect(plan(["packages/codegen/src/swift.ts"]).devices).toBe(true);
    expect(plan(["packages/lucent/src/cli/main.ts"]).devices).toBe(false);
    expect(plan(["apps/bare-example/App.tsx"]).devices).toBe(false);
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

  it("runs the SDK coverage job for its baseline", () => {
    expect(plan(["config/sdk-coverage.json"])).toMatchObject({ iosChecks: true, iosTest: false });
  });

  it("runs everything for CI and dependency changes", () => {
    for (const f of [
      ".github/workflows/ci.yml",
      ".github/actions/setup/action.yml",
      "pnpm-lock.yaml",
      "config/vitest.setup-sdk.ts",
    ])
      expect(plan([f])).toEqual(plan(undefined));
  });

  it("runs only the unit tests for the other workflows and the templates", () => {
    for (const f of [
      ".github/workflows/release.yml",
      ".github/dependabot.yml",
      ".github/ISSUE_TEMPLATE/bug.yml",
    ])
      expect(plan([f]).iosTest).toBe(false);
  });

  it("runs everything for a file no area places", () => {
    expect(plan(["newdir/thing.ts"])).toEqual(plan(undefined));
    expect(plan(["scripts/views-spike.ts"])).toEqual(plan(undefined));
  });
});

// A view-only module (T61, carried over from T41): its proxy runs the same
// stale-native check as any module's before it makes a component. Compiled
// three ways (as written, with a prop added, with setup changed), each
// proxy runs with the runtime's own loader against the identity another
// build's native code reports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { SETTINGS } from "./native-jsx-fixture.ts";

interface Identity {
  runtimeAbi: number;
  programs: Record<string, string>;
  apis: Record<string, Record<string, string>>;
}

/** The fixture compiled for iOS with `edit` applied to its files: its proxy and identity. */
function built(edit: (files: Record<string, string>) => Record<string, string> = (f) => f) {
  const files = edit({ ...SETTINGS });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-view-identity-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);

  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["ios"] },
  );
  expect(r.diagnostics).toEqual([]);

  return { proxy: r.proxies.get("settings")!, identity: r.identity! as Identity };
}

let host = 0;

/**
 * Runs `proxy` as the app's bundle would, its build's identity `expected`,
 * against native code built as `installed` says: what it exported, or what
 * it threw, and the components it made.
 */
function load(proxy: string, expected: Identity, installed: Identity) {
  const made: string[] = [];
  const loader = { exports: {} as Record<string, unknown> };

  new Function(
    "module",
    "exports",
    fs.readFileSync(path.join(runtimeDir(), "js/index.js"), "utf8"),
  )(loader, loader.exports);

  (globalThis as { __lucentModules?: unknown }).__lucentModules = {
    settings: {},
    __lucentIdentity: {
      // A new host each time: the loader remembers what it checked per host.
      host: ++host,
      runtimeAbi: installed.runtimeAbi,
      target: "ios",
      program: installed.programs.ios,
      modules: installed.apis.ios,
    },
  };

  const required: Record<string, unknown> = {
    "./_lucent/runtime.js": loader.exports,
    "./_lucent/identity.js": expected,
    "./_lucent/views.js": {
      lucentComponent: (c: { name: string }) => {
        made.push(c.name);
        return c.name;
      },
    },
    react: {},
    "react-native": { TurboModuleRegistry: { get: () => undefined } },
  };
  const exports: Record<string, unknown> = {};

  try {
    new Function("require", "exports", proxy)((spec: string) => required[spec], exports);
    return { exports, made };
  } catch (error) {
    return { error: error as Error & { code?: string; action?: string }, made };
  }
}

describe.skipIf(!sdkAvailable("ios"))("a view-only module's stale-native check", () => {
  afterEach(() => {
    delete (globalThis as { __lucentModules?: unknown }).__lucentModules;
    vi.restoreAllMocks();
  });

  const withSubtitle = (files: Record<string, string>) => ({
    ...files,
    "settings.lucent.ts": files["settings.lucent.ts"]!.replace(
      "enabled: boolean;",
      "enabled: boolean; subtitle?: string;",
    ),
  });
  const spacedOut = (files: Record<string, string>) => ({
    ...files,
    "settings.ios.lucent.tsx": files["settings.ios.lucent.tsx"]!.replace(
      "spacing={8}",
      "spacing={12}",
    ),
  });

  it("makes its components against the native code it was built with", () => {
    const now = built();
    const r = load(now.proxy, now.identity, now.identity);

    expect(r.error).toBeUndefined();
    expect(r.made).toEqual([expect.stringMatching(/^LucentSettings_/)]);
  });

  it("throws before making a component when the installed views have other props", () => {
    const installed = built();
    const now = built(withSubtitle);

    expect(now.identity.apis.ios!.settings).not.toBe(installed.identity.apis.ios!.settings);

    const r = load(now.proxy, now.identity, installed.identity);

    expect(r.error).toMatchObject({ code: "LUCENT_NATIVE_MISMATCH", action: "compile-native" });
    expect(r.error!.message).toContain(
      'module "settings" of the app\'s native code has other exports',
    );
    expect(r.made).toEqual([]);
  });

  it("runs a changed setup with a warning: its props, events and commands are the same", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const installed = built();
    const now = built(spacedOut);

    expect(now.identity.apis.ios!.settings).toBe(installed.identity.apis.ios!.settings);

    const r = load(now.proxy, now.identity, installed.identity);

    expect(r.error).toBeUndefined();
    expect(r.made).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("was not built from the sources"));
  });
});

/**
 * Web twins (decision 0133): `m.web.lucent.ts` is TypeScript the web bundle runs in m's
 * place. Native builds leave it out; a compile type-checks it with the
 * DOM's types against m's exports, reporting a mismatch at the twin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, findLucentFiles, twinOf, webTwins } from "../src/index.ts";

/** `sources` in a directory of their own; the files compiled are the Lucent ones, as a build finds them. */
function project(sources: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-web-twins-"));
  for (const [name, text] of Object.entries(sources)) fs.writeFileSync(path.join(dir, name), text);
  return { dir, files: findLucentFiles(dir) };
}

function build(sources: Record<string, string>) {
  const { dir, files } = project(sources);
  const r = compile(files, { platforms: ["host"] });
  return {
    r,
    dir,
    files,
    shown: r.diagnostics.map(
      (d) => `${d.code} ${path.basename(d.file ?? "")}:${d.line}: ${d.message}`,
    ),
  };
}

/** A key-value store: shared, its web twin on localStorage. */
const STORE = {
  "store.lucent.ts": `const values = new Map<string, string>();

export function save(key: string, value: string): void {
  values.set(key, value);
}

export function load(key: string): string | undefined {
  return values.get(key);
}
`,
  "store.web.lucent.ts": `import { PLATFORM } from "lucent:platform";

export function save(key: string, value: string): void {
  localStorage.setItem(key, value);
}

export function load(key: string): string | undefined {
  return localStorage.getItem(key) ?? undefined;
}

export const where: string = PLATFORM;
`,
};

describe("a module's web twin", () => {
  it("is left out of the Lucent files, and found beside its module", () => {
    const { dir, files } = project(STORE);
    expect(files.map((f) => path.basename(f))).toEqual(["store.lucent.ts"]);
    expect(webTwins(files)).toEqual([path.join(dir, "store.web.lucent.ts")]);
    expect(twinOf("/a/haptics.ios.lucent.ts")).toBe("/a/haptics.web.lucent.ts");
  });

  it("type-checks with the DOM's types against the module's exports, which it may add to", () => {
    const { r, dir, shown } = build(STORE);
    expect(shown).toEqual([]);
    // Not a module of the native build, but read by it: an edit checks again.
    expect([...r.proxies.keys()]).toEqual(["store"]);
    expect(r.read.has(path.join(dir, "store.web.lucent.ts"))).toBe(true);
  });

  it("is LUCENT3005 at the twin when an export is missing or has another type", () => {
    const missing = build({
      ...STORE,
      "store.web.lucent.ts": `export function save(key: string, value: string): void {
  localStorage.setItem(key, value);
}
`,
    });
    expect(missing.shown).toEqual([
      expect.stringMatching(
        /^LUCENT3005 store\.web\.lucent\.ts:1: store\.web\.lucent\.ts is store\.lucent\.ts's web twin, but doesn't export what store\.lucent\.ts exports, with its types: .*'load'/s,
      ),
    ]);

    const typed = build({
      ...STORE,
      "store.web.lucent.ts": STORE["store.web.lucent.ts"].replace(
        "load(key: string): string | undefined {\n  return localStorage.getItem(key) ?? undefined;",
        "load(key: number): string | undefined {\n  return localStorage.key(key) ?? undefined;",
      ),
    });
    expect(typed.shown).toEqual([
      "LUCENT3005 store.web.lucent.ts:1: store.web.lucent.ts is store.lucent.ts's web twin, but doesn't export what store.lucent.ts exports, with its types: Type 'store.web.lucent.ts' is not assignable to type 'store.lucent.ts'.\n  Types of property 'load' are incompatible.\n    Type '(key: number) => string | undefined' is not assignable to type '(key: string) => string | undefined'.\n      Types of parameters 'key' and 'key' are incompatible.\n        Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it("reports its own TypeScript errors at their lines", () => {
    const { shown } = build({
      ...STORE,
      "store.web.lucent.ts": `${STORE["store.web.lucent.ts"]}
export function size(): number {
  return localStorage.length.toUpperCase();
}
`,
    });
    expect(shown).toEqual([
      expect.stringMatching(/^LUCENT9001 store\.web\.lucent\.ts:14: TS2339: .*toUpperCase/),
    ]);
  });

  it("stands for a platform module, conforming to its declaration", () => {
    const sources = {
      "haptics.lucent.ts": "export declare function tap(strength: number): Promise<void>;\n",
      "haptics.ios.lucent.ts": "export async function tap(strength: number): Promise<void> {}\n",
      "haptics.android.lucent.ts":
        "export async function tap(strength: number): Promise<void> {}\n",
      "haptics.web.lucent.ts":
        "export async function tap(strength: number): Promise<void> {\n  navigator.vibrate(strength * 10);\n}\n",
    };
    expect(build(sources).shown).toEqual([]);
    expect(
      build({ ...sources, "haptics.web.lucent.ts": "export function tap(): void {}\n" }).shown,
    ).toEqual([expect.stringMatching(/^LUCENT3005 haptics\.web\.lucent\.ts:1: .*Promise<void>/s)]);
  });

  it("may be what a shared module's PLATFORM test names", () => {
    const { shown } = build({
      "m.lucent.ts": `import { PLATFORM } from "lucent:platform";

export function where(): string {
  return PLATFORM === "web" ? "the web" : PLATFORM;
}
`,
    });
    expect(shown).toEqual([]);
  });
});

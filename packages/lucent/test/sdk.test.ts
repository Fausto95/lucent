import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sdkAvailable } from "@lucent-lang/compiler";

const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");
const javac = spawnSync("javac", ["-version"]).status === 0;
const android = sdkAvailable("android");

/** An app whose classpath has the fixture library (com.example.widgets), as Gradle would write it. */
function app(): { root: string; cache: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-sdk-"));
  const classes = path.join(root, "classes");
  const sources = spawnSync("find", [path.resolve(import.meta.dirname, "../../bindgen/test/fixtures/java"), "-name", "*.java"], { encoding: "utf8" }).stdout.trim().split("\n");
  spawnSync("javac", ["--release", "11", "-d", classes, ...sources]);
  const jar = path.join(root, "widgets.jar");
  spawnSync("jar", ["cf", jar, "-C", classes, "."]);
  fs.mkdirSync(path.join(root, ".lucent"), { recursive: true });
  fs.writeFileSync(path.join(root, ".lucent/android-classpath.json"), JSON.stringify({ jars: [jar], aars: [] }));
  fs.writeFileSync(path.join(root, "w.android.lucent.ts"), 'import { Widget } from "lucent:android/com.example.widgets";\nexport async function f(): Promise<string> { return new Widget().getName(); }\n');
  fs.writeFileSync(path.join(root, "w.ios.lucent.ts"), 'export async function f(): Promise<string> { return ""; }\n');
  fs.writeFileSync(path.join(root, "w.lucent.ts"), "export declare function f(): Promise<string>;\n");
  return { root, cache: fs.mkdtempSync(path.join(os.tmpdir(), "lucent-sdk-cache-")) };
}

function lucent(a: { root: string; cache: string }, ...args: string[]) {
  const r = spawnSync(process.execPath, [bin, "sdk", ...args, "--root", a.root], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", LUCENT_CACHE_DIR: a.cache } });
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

describe.skipIf(!javac || !android)("lucent sdk", () => {
  it("search finds classes and members, grouped by platform and module, with the import to copy", () => {
    const a = app();
    const r = lucent(a, "search", "widget");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/android +com\.example\.widgets/);
    expect(r.out).toMatch(/class +Widget/);
    expect(r.out).toContain('import { Widget } from "lucent:android/com.example.widgets";');
    const members = lucent(a, "search", "getName");
    expect(members.out).toMatch(/method +Widget\.getName\(\)/);
    // What it searched: the project's modules and the cache, not a cold SDK.
    expect(r.out).toMatch(/searched \d+ modules?/);
  });

  it("search and prefetch --json match their schemas", async () => {
    const a = app();
    const { default: Ajv } = (await import("ajv")) as unknown as { default: new (o: object) => { compile(s: object): ((v: unknown) => boolean) & { errors?: unknown[] } } };
    for (const [schema, args] of [["sdk-search", ["search", "Widget", "--json"]], ["sdk-prefetch", ["prefetch", "--json"]]] as const) {
      const check = new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../schemas/${schema}.schema.json`), "utf8")) as object);
      const value = JSON.parse(lucent(a, ...args).stdout) as unknown;
      expect(check(value), JSON.stringify(check.errors)).toBe(true);
    }
  });

  it("prefetch fetches the project's imports only, by default", () => {
    const a = app();
    const r = JSON.parse(lucent(a, "prefetch", "--json").stdout) as { modules: { module: string }[] };
    // No iOS import: nothing of iOS (an empty list is not `--ios` alone, which means every module).
    expect(r.modules.map((m) => m.module)).toEqual(["lucent:android/com.example.widgets"]);
  });

  it("search --json lists the matches", () => {
    const a = app();
    const matches = JSON.parse(lucent(a, "search", "Widget", "--json").stdout) as { matches: { platform: string; module: string; kind: string; name: string; import: string }[] };
    expect(matches.matches).toContainEqual(expect.objectContaining({ platform: "android", module: "com.example.widgets", kind: "class", name: "Widget", import: 'import { Widget } from "lucent:android/com.example.widgets";' }));
  });

  it("show prints the declaration Lucent code sees", () => {
    const a = app();
    const r = lucent(a, "show", "com.example.widgets.Widget");
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^\/\/ lucent:android\/com\.example\.widgets\n/);
    expect(r.out).toMatch(/export declare class Widget[\s\S]*getName\(\): string;/);
    const member = lucent(a, "show", "com.example.widgets.Widget.getName");
    expect(member.out).toMatch(/getName\(\): string;/);
    expect(member.out).not.toMatch(/export declare class OnEvent/);
  });

  it("show says when a symbol does not exist", () => {
    const a = app();
    const r = lucent(a, "show", "com.example.widgets.Nope");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no Nope in lucent:android\/com\.example\.widgets/);
  });
});

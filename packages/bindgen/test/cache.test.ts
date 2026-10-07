import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { extractionCount, forgetLoadedSdks, sdkAvailable, sdkModule } from "../src/provider.ts";
import { filesIn, schemaFiles } from "./cache-files.ts";
import { javac, javaJar } from "./java-fixtures.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const xcode = sdkAvailable("ios");
const androidSdk = sdkAvailable("android");

const made: string[] = [];
const tmp = (prefix: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const TRACKER = {
  "dev/orbit/tracking/Tracker.java": `package dev.orbit.tracking;
public class Tracker {
  public Tracker() {}
  public int count() { return 0; }
}`,
};

interface Lookup {
  extracted: number;
  found: { schema: unknown } | { missing: string };
  ms: number;
}

/** A lookup in another process, as another build would do it. */
function lookupIn(
  platform: string,
  module: string,
  opts: object,
): Promise<Lookup> & {
  child: ReturnType<typeof spawn>;
} {
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [path.join(here, "sdk-lookup.ts"), platform, module, JSON.stringify(opts)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));

  const done = new Promise<Lookup>((resolve, reject) =>
    child.on("exit", (code, signal) => {
      if (code === 0) resolve({ ...JSON.parse(out), ms: Date.now() - started });
      else reject(new Error(`lookup exited with ${code ?? signal}: ${err}`));
    }),
  );

  return Object.assign(done, { child });
}

/** Resolves once a lock file appears under `dir` (an extraction started). */
async function lockAppears(dir: string, timeout: number): Promise<boolean> {
  for (const end = Date.now() + timeout; Date.now() < end;) {
    if (filesIn(dir).some((f) => f.endsWith(".lock"))) return true;
    await new Promise((r) => setTimeout(r, 2));
  }

  return false;
}

describe.skipIf(!javac)("extraction cache", () => {
  it("extracts again over a cached schema that is not whole", () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = javaJar(path.join(tmp("lucent-jar-"), "tracking.jar"), TRACKER);
    const opts = { cacheDir, android: { jars: [jar] } };

    const cold = sdkModule("android", "dev.orbit.tracking", opts);
    const [file] = schemaFiles(cacheDir, "dev.orbit.tracking");
    const text = fs.readFileSync(file!, "utf8");
    fs.writeFileSync(file!, text.slice(0, text.length / 2));
    forgetLoadedSdks();
    const before = extractionCount();

    const again = sdkModule("android", "dev.orbit.tracking", opts);

    expect(again).toEqual(cold);
    expect(extractionCount()).toBe(before + 1);
    expect(JSON.parse(fs.readFileSync(file!, "utf8"))).toBeTruthy();
  });

  it("extracts a module once when several builds want it at the same time", async () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = javaJar(path.join(tmp("lucent-jar-"), "tracking.jar"), TRACKER);
    const opts = { cacheDir, android: { jars: [jar] } };

    const all = await Promise.all(
      [1, 2, 3, 4].map(() => lookupIn("android", "dev.orbit.tracking", opts)),
    );

    expect(all.reduce((n, r) => n + r.extracted, 0)).toBe(1);
    for (const r of all) expect(r.found).toEqual(all[0]!.found);
    expect("schema" in all[0]!.found).toBe(true);
  });

  it("caches no schema for a failed extraction, and extracts once it can", () => {
    const cacheDir = tmp("lucent-cache-");
    const jar = path.join(tmp("lucent-jar-"), "tracking.jar");
    fs.writeFileSync(jar, "not a zip");
    const opts = { cacheDir, android: { jars: [jar] } };

    expect(() => sdkModule("android", "dev.orbit.tracking", opts)).toThrow(/zip/);
    expect(schemaFiles(cacheDir, "dev.orbit.tracking")).toEqual([]);

    javaJar(jar, TRACKER);
    forgetLoadedSdks();
    const before = extractionCount();
    const r = sdkModule("android", "dev.orbit.tracking", opts);

    expect("schema" in r && r.schema.types.map((t) => t.name)).toEqual(["Tracker"]);
    expect(extractionCount()).toBe(before + 1);
  });
});

describe.skipIf(!androidSdk)("extraction cache: a writer killed mid-extraction", () => {
  it("takes over the lock at once and extracts", async () => {
    const opts = { cacheDir: tmp("lucent-cache-") };
    let killed = false;

    // The kill must land while the writer holds the lock: retry if it finished first.
    for (let attempt = 0; attempt < 5 && !killed; attempt++) {
      fs.rmSync(opts.cacheDir, { recursive: true, force: true });
      const writer = lookupIn("android", "android.view", opts);
      writer.catch(() => {});

      if (await lockAppears(opts.cacheDir, 20_000)) {
        killed = writer.child.kill("SIGKILL");
        await new Promise((r) => writer.child.on("exit", r));
        killed &&= filesIn(opts.cacheDir).some((f) => f.endsWith(".lock"));
      } else await writer;
    }
    expect(killed).toBe(true);

    const next = lookupIn("android", "android.view", opts);
    const timer = setTimeout(() => next.child.kill("SIGKILL"), 60_000);
    const r = await next;
    clearTimeout(timer);

    expect("schema" in r.found).toBe(true);
    expect(r.extracted).toBe(1);
    expect(r.ms).toBeLessThan(30_000);
  }, 120_000);
});

describe.skipIf(!xcode)("extraction cache: iOS", () => {
  const widgets = (dir: string, body: string) => {
    fs.writeFileSync(path.join(dir, "module.modulemap"), 'module Gizmos { header "Gizmos.h" }\n');
    fs.writeFileSync(
      path.join(dir, "Gizmos.h"),
      `#import <Foundation/Foundation.h>\n@interface GZMGizmo : NSObject\n${body}\n@end\n`,
    );
  };

  // A cold cache on purpose: the SDK modules its fixture names are extracted too, minutes on CI.
  it("caches no schema for a module that did not compile, and extracts it once it does", () => {
    const dir = tmp("lucent-gizmos-");
    widgets(dir, "- (void)spin:(NoSuchType *)x;");
    const opts = { cacheDir: tmp("lucent-cache-"), ios: { includePaths: [dir] } };

    const failed = sdkModule("ios", "Gizmos", opts);

    expect(failed).toEqual({ missing: expect.stringMatching(/Gizmos.*no symbol graph/s) });
    expect(schemaFiles(opts.cacheDir, "Gizmos")).toEqual([]);

    widgets(dir, "- (void)spin:(NSInteger)x;");
    forgetLoadedSdks();
    const fixed = sdkModule("ios", "Gizmos", opts);

    expect("schema" in fixed && fixed.schema.types.map((t) => t.name)).toEqual(["GZMGizmo"]);
  }, 600_000);

  it("takes over the lock of a writer killed mid-extraction", async () => {
    const dir = tmp("lucent-gizmos-");
    widgets(dir, "- (void)spin:(NSInteger)x;");
    const opts = { cacheDir: tmp("lucent-cache-"), ios: { includePaths: [dir] } };

    const writer = lookupIn("ios", "Gizmos", opts);
    writer.catch(() => {});
    expect(await lockAppears(opts.cacheDir, 60_000)).toBe(true);
    writer.child.kill("SIGKILL");
    await new Promise((r) => writer.child.on("exit", r));

    const next = lookupIn("ios", "Gizmos", opts);
    const timer = setTimeout(() => next.child.kill("SIGKILL"), 150_000);
    const r = await next;
    clearTimeout(timer);

    expect("schema" in r.found).toBe(true);
    expect(r.extracted).toBe(1);
    // Extracting takes seconds; the stale-lock timeout, minutes.
    expect(r.ms).toBeLessThan(120_000);
  }, 240_000);
});

describe("pruning the cache", () => {
  it("keeps this extractor's entries and recently used ones of others", async () => {
    const { pruneStaleCache } = await import("../src/provider.ts");
    const { extractorVersion } = await import("../src/provenance.ts");
    const cacheDir = tmp("lucent-prune-");
    const scope = (name: string, version?: string) => {
      const dir = path.join(cacheDir, "sdk/ios", name);
      fs.mkdirSync(dir, { recursive: true });
      if (version) fs.writeFileSync(path.join(dir, ".extractor"), `${version}\n`);
      return dir;
    };
    const mine = scope("iphonesimulator27.0-A-mine", extractorVersion());
    const recent = scope("iphonesimulator27.0-A-recent", "00000000");
    const old = scope("iphonesimulator27.0-A-old", "11111111");
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(old, ".extractor"), past, past);
    const memo = path.join(cacheDir, "memo", extractorVersion());
    fs.mkdirSync(memo, { recursive: true });

    const pruned = pruneStaleCache({ cacheDir, unusedFor: 14 * 24 * 3600 * 1000 });

    expect(pruned.map((p) => p.path)).toEqual([old]);
    for (const kept of [mine, recent, memo]) expect(fs.existsSync(kept)).toBe(true);
    expect(pruneStaleCache({ cacheDir }).map((p) => p.path)).toEqual([recent]);
  });
});

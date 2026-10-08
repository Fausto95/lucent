/**
 * Swift modules made from source for Lucent to read: Swift pods built as
 * static libraries, whose modules Xcode writes among a build's products,
 * and the Swift a Lucent package lists in ios.nativeSources, which builds
 * into LucentNative itself. Each is emitted (`swiftc -emit-module`, type
 * checked, no code generated) into the cache against the app's pods'
 * search paths, keyed by its sources' contents, the SDK and the target;
 * a module whose Swift pods it depends on are emitted first sees theirs.
 * Building the pods' targets with xcodebuild would build their
 * dependencies too (React Native's), for nothing Lucent reads.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cacheRoot, hash, publishDir } from "./cache.ts";
import { contentHash } from "./provenance.ts";

/** The module a Lucent package's ios.nativeSources Swift belongs to: LucentNative's, which builds it. */
export const OWN_SWIFT_MODULE = "LucentNative";

/** A Swift module to emit from its sources. */
export interface SwiftSourceModule {
  module: string;
  sources: string[];
  /** The pod it is (`Name@version`), when one. */
  pod?: string;
  /** The modules of this list it imports, emitted before it. */
  dependencies: string[];
}

/** A module planned: where its `.swiftmodule` is (once emitted), and what it needs. */
export interface PlannedSwiftModule extends SwiftSourceModule {
  /** The directory `-I` finds it in: named after its sources, the SDK, the target and its dependencies'. */
  dir: string;
  key: string;
}

export interface SwiftModuleContext {
  cacheDir?: string;
  xcrun: string;
  sdk: { path: string; version: string; build: string };
  target: string;
  includePaths: string[];
  frameworkPaths: string[];
  moduleMaps: string[];
  defines: string[];
}

/**
 * Where each of `modules` is emitted, without emitting it: a module's key
 * is its sources' contents, the SDK, the target, the defines and its
 * dependencies' keys. A cycle among them is left out, with why.
 */
export function planSwiftModules(
  modules: SwiftSourceModule[],
  ctx: SwiftModuleContext,
): { planned: Map<string, PlannedSwiftModule>; failures: Map<string, string> } {
  const planned = new Map<string, PlannedSwiftModule>();
  const failures = new Map<string, string>();
  const byName = new Map(modules.map((m) => [m.module, m]));

  const plan = (m: SwiftSourceModule, seen: string[]): PlannedSwiftModule | undefined => {
    const done = planned.get(m.module);
    if (done || failures.has(m.module)) return done;
    if (seen.includes(m.module)) {
      failures.set(m.module, `its pods depend on each other (${[...seen, m.module].join(" → ")})`);
      return undefined;
    }

    const deps = [...new Set(m.dependencies)].filter((d) => d !== m.module && byName.has(d));
    const depPlans = deps.map((d) => plan(byName.get(d)!, [...seen, m.module]));
    if (depPlans.some((d) => !d)) {
      if (!failures.has(m.module))
        failures.set(
          m.module,
          `${deps.find((d) => !planned.has(d))}, which it imports, has no module`,
        );
      return undefined;
    }

    const key = hash([
      m.module,
      contentHash(m.sources),
      ...m.sources.map((s) => path.basename(s)),
      `${ctx.sdk.version} ${ctx.sdk.build}`,
      ctx.target,
      ...ctx.defines,
      ...depPlans.map((d) => d!.key),
    ]);
    const p = {
      ...m,
      dependencies: deps,
      key,
      dir: path.join(cacheRoot(ctx.cacheDir), "swift-modules", `${m.module}-${key}`),
    };
    planned.set(m.module, p);
    return p;
  };

  for (const m of modules) plan(m, []);
  return { planned, failures };
}

/**
 * Emits a planned module, its dependencies first, unless it is in the
 * cache already (any process's). Undefined when it is there; else why it
 * could not be, with swiftc's last errors.
 */
export function emitSwiftModule(
  planned: ReadonlyMap<string, PlannedSwiftModule>,
  module: string,
  ctx: SwiftModuleContext,
  failed: Map<string, string> = new Map(),
): string | undefined {
  const m = planned.get(module);
  if (!m) return failed.get(module);
  if (failed.has(module)) return failed.get(module);
  if (fs.existsSync(m.dir)) return undefined;

  for (const d of m.dependencies) {
    const why = emitSwiftModule(planned, d, ctx, failed);
    if (why) {
      failed.set(module, `${d}, which it imports, could not be built: ${why}`);
      return failed.get(module);
    }
  }

  try {
    publishDir(m.dir, (tmp) => {
      const deps = m.dependencies.map((d) => planned.get(d)!.dir);
      const r = spawnSync(ctx.xcrun, emitArgs(m, ctx, deps, tmp), {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      if (r.status !== 0) {
        const errors = `${r.stderr ?? ""}${r.error?.message ?? ""}`.trim().split("\n");
        throw new Error(errors.slice(-10).join("\n") || `swiftc exited with ${r.status}`);
      }
    });
  } catch (e) {
    failed.set(module, `swiftc could not emit its module: ${(e as Error).message}`);
    return failed.get(module);
  }

  return undefined;
}

/** xcrun's arguments that emit `m` into `out`, seeing the app's pods and the modules in `deps`. */
export function emitArgs(
  m: SwiftSourceModule,
  ctx: SwiftModuleContext,
  deps: string[],
  out: string,
): string[] {
  return [
    "swiftc",
    "-emit-module",
    "-parse-as-library",
    "-module-name",
    m.module,
    "-target",
    ctx.target,
    "-sdk",
    ctx.sdk.path,
    "-emit-module-path",
    path.join(out, `${m.module}.swiftmodule`),
    "-D",
    "COCOAPODS",
    ...[...deps, ...ctx.includePaths].flatMap((i) => ["-I", i]),
    ...ctx.frameworkPaths.flatMap((f) => ["-F", f]),
    ...ctx.moduleMaps.flatMap((map) => ["-Xcc", `-fmodule-map-file=${map}`]),
    ...ctx.defines.flatMap((d) => ["-Xcc", `-D${d}`]),
    ...m.sources,
  ];
}

/** The `.swift` files under `dirs`, sorted; hidden directories and node_modules aside. */
export function swiftFilesUnder(dirs: string[]): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".swift")) out.add(full);
    }
  };
  for (const d of dirs) walk(d);

  return [...out].sort();
}

/** The modules `sources` import (`import X`, `@_exported import X`, `import struct X.Y`). */
export function importsOf(sources: string[]): string[] {
  const out = new Set<string>();
  for (const f of sources) {
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(
      /^\s*(?:@\w+(?:\([^)]*\))?\s+)*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?(\w+)/gm,
    ))
      out.add(m[1]!);
  }

  return [...out].sort();
}

/** `lucent build` as a library: discovery, incremental compilation, host emission. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  COMPILER_VERSION,
  compile,
  printIR,
  renderDiagnostic,
  type IRModule,
  type LucentSourceMap,
} from "@lucent-lang/compiler";
import {
  capabilityFiles,
  loadLucentConfig,
  loadLucentSources,
  loadNativeSidecars,
  type FileTree,
  type Host,
  type NativeSidecars,
} from "@lucent-lang/host-core";
import { expoHost } from "@lucent-lang/host-expo";
import { nitroHost } from "@lucent-lang/host-nitro";

export type HostName = "expo" | "nitro";

export const HOST_NAMES = ["expo", "nitro"] as const satisfies readonly HostName[];

export const HOSTS: Readonly<Record<HostName, Host>> = { expo: expoHost, nitro: nitroHost };

/** Where each host's package lives, relative to the project root. */
const OUT_DIRS: Readonly<Record<HostName, string>> = {
  expo: "modules/lucent",
  nitro: ".lucent/nitro",
};

export const defaultOutDir = (host: HostName): string => OUT_DIRS[host];

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".lucent",
  "ios",
  "android",
  "modules",
  "build",
  "dist",
  ".expo",
]);

export function findLucentFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(join(dir, entry.name));
      } else if (/\.lucent\.tsx?$/.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.toSorted();
}

export interface BuildOptions {
  root: string;
  host: HostName;
  /** Explicit files instead of discovery (absolute or root-relative). */
  files?: string[];
  outDir?: string;
  emitIR?: boolean;
  /** Skip the cache and recompile everything. */
  force?: boolean;
  /** Run the host's post-generate step (nitrogen). Off in tests. */
  postGenerate?: boolean;
  /** Enable optional HIR optimization passes. */
  optimize?: boolean;
  /** Emit lucent.map.json alongside IR (implies sourceMap on compile when emitIR). */
  sourceMap?: boolean;
  log?: (line: string) => void;
}

export interface BuildDiagnostic {
  severity?: "error" | "warning";
  fileName: string;
  rendered: string;
}

export interface BuildResult {
  ok: boolean;
  outDir: string;
  compiled: string[];
  cached: string[];
  diagnostics: BuildDiagnostic[];
  /** Modules produced by this build (compiled or cached), for analyze/explain. */
  modules: IRModule[];
  /** Optimization log lines when `--optimize` ran. */
  optimizeLog: string[];
}

interface CacheFile {
  compilerVersion: string;
  host: HostName;
  modules: Record<string, { hash: string; module: IRModule; diagnostics?: BuildDiagnostic[] }>;
}

const hashOf = (source: string, host: HostName, optimize: boolean): string =>
  createHash("sha256")
    .update(`${COMPILER_VERSION}\0${host}\0${optimize ? "opt" : "base"}\0${source}`)
    .digest("hex");

export async function build(options: BuildOptions): Promise<BuildResult> {
  const log = options.log ?? (() => {});
  const root = options.root;
  const optimize = options.optimize === true;
  const wantSourceMap = options.sourceMap === true || options.emitIR === true;
  const outDir = join(root, options.outDir ?? defaultOutDir(options.host));
  const sourceMaps = new Map<string, LucentSourceMap>();
  const empty = (diagnostics: BuildDiagnostic[]): BuildResult => ({
    ok: false,
    outDir,
    compiled: [],
    cached: [],
    diagnostics,
    modules: [],
    optimizeLog: [],
  });
  let config;
  try {
    config = loadLucentConfig(root);
  } catch (error) {
    return empty([{ fileName: "lucent.config.json", rendered: String(error) }]);
  }
  const cachePath = join(root, ".lucent", "cache.json");
  const cache = options.force ? null : readCache(cachePath, options.host);
  const files = (options.files ?? findLucentFiles(root)).map((f) => (f.startsWith("/") ? f : join(root, f)));

  const nextCache: CacheFile = { compilerVersion: COMPILER_VERSION, host: options.host, modules: {} };
  const modules: IRModule[] = [];
  const compiled: string[] = [];
  const cachedFiles: string[] = [];
  const diagnostics: BuildDiagnostic[] = [];
  const optimizeLog: string[] = [];
  const sidecars: NativeSidecars = { swift: {}, kotlin: {} };

  for (const file of files) {
    const rel = relative(root, file);
    const source = readFileSync(file, "utf8");
    const sources = loadLucentSources(file, source);
    // Sidecars are part of the module's native output, so a change to one has
    // to miss the cache exactly as a change to the Lucent source does.
    const moduleSidecars = loadNativeSidecars(Object.keys(sources));
    // Merged before the cache check: a cached module still ships its sidecars.
    Object.assign(sidecars.swift, moduleSidecars.swift);
    Object.assign(sidecars.kotlin, moduleSidecars.kotlin);
    const hash = hashOf(
      JSON.stringify([
        Object.entries(sources).toSorted(([a], [b]) => a.localeCompare(b)),
        moduleSidecars,
        config.libraries,
        config.targets,
      ]),
      options.host,
      optimize,
    );
    const hit = cache?.modules[rel];
    if (hit && hit.hash === hash) {
      log(`✓ ${rel} cached`);
      cachedFiles.push(rel);
      diagnostics.push(...(hit.diagnostics ?? []));
      modules.push(hit.module);
      nextCache.modules[rel] = hit;
      if (wantSourceMap) {
        const mapped = compile(source, {
          fileName: file,
          sources,
          targets: config.targets,
          libraries: config.libraries,
          ...(optimize ? { optimize: true } : {}),
          sourceMap: true,
        });
        if (mapped.sourceMap && mapped.module) sourceMaps.set(mapped.module.name, mapped.sourceMap);
      }
      continue;
    }
    log(`⚙ ${rel} compiling`);
    const result = compile(source, {
      fileName: file,
      sources,
      targets: config.targets,
      libraries: config.libraries,
      ...(optimize ? { optimize: true } : {}),
      ...(wantSourceMap ? { sourceMap: true } : {}),
    });
    const reported = result.diagnostics.map((d) => ({
      fileName: rel,
      rendered: renderDiagnostic(d, source, rel),
      ...(d.severity ? { severity: d.severity } : {}),
    }));
    diagnostics.push(...reported);
    if (result.optimizeLog) optimizeLog.push(...result.optimizeLog.map((line) => `${rel}: ${line}`));
    if (!result.module) continue;
    compiled.push(rel);
    modules.push(result.module);
    if (result.sourceMap) sourceMaps.set(result.module.name, result.sourceMap);
    nextCache.modules[rel] = { hash, module: result.module, diagnostics: reported };
  }

  for (const module of modules)
    for (const capability of module.capabilities ?? []) {
      if (!config.capabilities.includes(capability))
        diagnostics.push({
          fileName: "lucent.config.json",
          rendered: `error LUCENT2001: Missing capability "${capability}" required by ${module.name}. Enable it in lucent.config.ts or lucent.config.json.`,
        });
    }
  const names = new Set<string>();
  for (const module of modules) {
    if (names.has(module.name))
      diagnostics.push({
        fileName: module.name,
        rendered: `Duplicate native module name ${module.name}; use distinct Lucent file basenames.`,
      });
    names.add(module.name);
  }
  if (diagnostics.some((d) => d.severity !== "warning"))
    return { ok: false, outDir, compiled, cached: cachedFiles, diagnostics, modules, optimizeLog };

  const host = HOSTS[options.host];
  const tree = host.emitPackage(modules, { packageName: "lucent", sidecars });
  for (const [path, contents] of capabilityFiles(config.platformConfig)) tree.set(path, contents);
  tree.set(
    "lucent-manifest.json",
    JSON.stringify(
      {
        compilerVersion: COMPILER_VERSION,
        host: options.host,
        capabilities: [...new Set(modules.flatMap((m) => m.capabilities ?? []))],
        modules: modules.map((m) => m.name),
      },
      null,
      2,
    ) + "\n",
  );
  writeTree(outDir, tree);
  if (options.emitIR) {
    for (const m of modules) {
      writeIfChanged(join(root, ".lucent", "ir", `${m.name}.ir.txt`), printIR(m));
      const map = sourceMaps.get(m.name);
      if (map)
        writeIfChanged(join(root, ".lucent", "ir", `${m.name}.lucent.map.json`), JSON.stringify(map, null, 2) + "\n");
    }
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(nextCache));
  if (options.postGenerate && host.postGenerate) await host.postGenerate(outDir);
  return { ok: true, outDir, compiled, cached: cachedFiles, diagnostics, modules, optimizeLog };
}

function readCache(path: string, host: HostName): CacheFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    return parsed.compilerVersion === COMPILER_VERSION && parsed.host === host ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes the tree, only touching files whose contents changed, and removing stale generated files. */
function writeTree(dir: string, files: FileTree): void {
  const manifest = join(dir, ".lucent-files.json");
  let previous: string[] = [];
  if (existsSync(manifest)) {
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    if (Array.isArray(parsed))
      previous = parsed.filter(
        (p): p is string => typeof p === "string" && !p.startsWith("/") && !p.split(/[\\/]/).includes(".."),
      );
  }
  for (const [rel, contents] of files) writeIfChanged(join(dir, rel), contents);
  for (const rel of previous) if (!files.has(rel) && existsSync(join(dir, rel))) rmSync(join(dir, rel));
  writeIfChanged(manifest, JSON.stringify([...files.keys()].toSorted()) + "\n");
}

function writeIfChanged(path: string, contents: string): void {
  if (existsSync(path) && statSync(path).isFile() && readFileSync(path, "utf8") === contents) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** `lucent build` as a library: discovery, incremental compilation, host emission. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { COMPILER_VERSION, compile, printIR, renderDiagnostic, type IRModule } from "@lucent/compiler";
import type { FileTree, Host } from "@lucent/host-core";
import { expoHost } from "@lucent/host-expo";
import { nitroHost } from "@lucent/host-nitro";

export type HostName = "expo" | "nitro";

export const HOSTS: Readonly<Record<HostName, Host>> = { expo: expoHost, nitro: nitroHost };

/** Where each host's package lives, relative to the project root. */
const OUT_DIRS: Readonly<Record<HostName, string>> = {
  expo: "modules/lucent",
  nitro: ".lucent/nitro",
};

export const defaultOutDir = (host: HostName): string => OUT_DIRS[host];

const SKIP_DIRS: ReadonlySet<string> = new Set([
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
      } else if (entry.name.endsWith(".lucent.ts")) {
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
  log?: (line: string) => void;
}

export interface BuildDiagnostic {
  fileName: string;
  rendered: string;
}

export interface BuildResult {
  ok: boolean;
  outDir: string;
  compiled: string[];
  cached: string[];
  diagnostics: BuildDiagnostic[];
}

interface CacheFile {
  compilerVersion: string;
  host: HostName;
  modules: Record<string, { hash: string; module: IRModule }>;
}

const hashOf = (source: string, host: HostName): string =>
  createHash("sha256").update(`${COMPILER_VERSION}\0${host}\0${source}`).digest("hex");

export async function build(options: BuildOptions): Promise<BuildResult> {
  const log = options.log ?? (() => {});
  const root = options.root;
  const outDir = join(root, options.outDir ?? defaultOutDir(options.host));
  const cachePath = join(root, ".lucent", "cache.json");
  const cache = options.force ? null : readCache(cachePath, options.host);
  const files = (options.files ?? findLucentFiles(root)).map((f) => (f.startsWith("/") ? f : join(root, f)));

  const nextCache: CacheFile = { compilerVersion: COMPILER_VERSION, host: options.host, modules: {} };
  const modules: IRModule[] = [];
  const compiled: string[] = [];
  const cachedFiles: string[] = [];
  const diagnostics: BuildDiagnostic[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const source = readFileSync(file, "utf8");
    const hash = hashOf(source, options.host);
    const hit = cache?.modules[rel];
    if (hit && hit.hash === hash) {
      log(`✓ ${rel} cached`);
      cachedFiles.push(rel);
      modules.push(hit.module);
      nextCache.modules[rel] = hit;
      continue;
    }
    log(`⚙ ${rel} compiling`);
    const result = compile(source, { fileName: file });
    if (!result.module) {
      for (const d of result.diagnostics)
        diagnostics.push({ fileName: rel, rendered: renderDiagnostic(d, source, rel) });
      continue;
    }
    compiled.push(rel);
    modules.push(result.module);
    nextCache.modules[rel] = { hash, module: result.module };
  }

  if (diagnostics.length) return { ok: false, outDir, compiled, cached: cachedFiles, diagnostics };

  const host = HOSTS[options.host];
  writeTree(outDir, host.emitPackage(modules, { packageName: "lucent" }));
  if (options.emitIR) {
    for (const m of modules) writeIfChanged(join(root, ".lucent", "ir", `${m.name}.ir.txt`), printIR(m));
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(nextCache));
  if (options.postGenerate && host.postGenerate) await host.postGenerate(outDir);
  return { ok: true, outDir, compiled, cached: cachedFiles, diagnostics };
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
  const keep = new Set<string>();
  for (const [rel, contents] of files) {
    writeIfChanged(join(dir, rel), contents);
    keep.add(rel);
  }
  if (!existsSync(dir)) return;
  for (const existing of listFiles(dir)) {
    if (keep.has(existing) || existing.startsWith("nitrogen/") || existing.startsWith("node_modules/")) continue;
    rmSync(join(dir, existing));
  }
}

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function writeIfChanged(path: string, contents: string): void {
  if (existsSync(path) && statSync(path).isFile() && readFileSync(path, "utf8") === contents) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

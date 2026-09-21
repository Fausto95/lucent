/** `lucent build` as a library: discovery, incremental compilation, host emission. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { COMPILER_VERSION, compile, printIR, renderDiagnostic, type IRModule } from "@lucent-lang/compiler";
import { loadLucentConfig, loadLucentSources, type FileTree, type Host } from "@lucent-lang/host-core";
import { expoHost } from "@lucent-lang/host-expo";
import { nitroHost } from "@lucent-lang/host-nitro";

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
  let config;
  try {
    config = loadLucentConfig(root);
  } catch (error) {
    return {
      ok: false,
      outDir,
      compiled: [],
      cached: [],
      diagnostics: [{ fileName: "lucent.config.json", rendered: String(error) }],
    };
  }
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
    const sources = loadLucentSources(file, source);
    const hash = hashOf(
      JSON.stringify([Object.entries(sources).toSorted(([a], [b]) => a.localeCompare(b)), config.libraries]),
      options.host,
    );
    const hit = cache?.modules[rel];
    if (hit && hit.hash === hash) {
      log(`✓ ${rel} cached`);
      cachedFiles.push(rel);
      modules.push(hit.module);
      nextCache.modules[rel] = hit;
      continue;
    }
    log(`⚙ ${rel} compiling`);
    const result = compile(source, { fileName: file, sources, libraries: config.libraries });
    if (!result.module) {
      for (const d of result.diagnostics)
        diagnostics.push({ fileName: rel, rendered: renderDiagnostic(d, source, rel) });
      continue;
    }
    compiled.push(rel);
    modules.push(result.module);
    nextCache.modules[rel] = { hash, module: result.module };
  }

  for (const module of modules)
    for (const capability of module.capabilities ?? []) {
      if (!config.capabilities.includes(capability))
        diagnostics.push({
          fileName: "lucent.config.json",
          rendered: `Missing capability "${capability}" required by ${module.name}. Enable it in lucent.config.json.`,
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
  if (diagnostics.length) return { ok: false, outDir, compiled, cached: cachedFiles, diagnostics };

  const host = HOSTS[options.host];
  const tree = host.emitPackage(modules, { packageName: "lucent" });
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

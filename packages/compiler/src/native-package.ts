import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EmitResult } from "./emit/index.ts";
import { coreTypesPath } from "./program.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Location of @lucent-lang/runtime (C++ runtime and native templates). */
export function runtimeDir(): string {
  return path.resolve(here, "../../runtime");
}

export interface WriteResult {
  outDir: string;
  written: string[];
  unchanged: number;
  removed: string[];
  /** True when files were added or removed (pods / Gradle need a resync). */
  structureChanged: boolean;
}

/**
 * A key for everything a build depends on: the sources, the compiler, the
 * runtime and templates it copies, and the output location. Content, not
 * versions, so edits to the compiler or runtime invalidate it too.
 */
export function inputsKey(files: string[], outDir: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(path.resolve(outDir));
  const compilerRoot = path.resolve(here, "..");
  const deps = [...listFiles(path.join(compilerRoot, "src")), ...listFiles(path.join(compilerRoot, "lib")), ...listFiles(runtimeDir()).filter((f) => !f.includes(`${path.sep}test${path.sep}`)), coreTypesPath()];
  for (const f of [...files.map((f) => path.resolve(f)).sort(), ...deps.sort()]) {
    hash.update(f);
    hash.update(fs.readFileSync(f));
  }
  return hash.digest("hex");
}

/** Whether `outDir` was written by a build with the same inputs. */
export function isUpToDate(outDir: string, key: string): boolean {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")).inputs === key;
  } catch {
    return false;
  }
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Writes the native package React Native autolinks: the C++ runtime, the
 * generated module code, the TurboModule host, build files for both
 * platforms, and the JavaScript proxies. Files whose content did not change
 * are left alone so native builds stay incremental.
 */
export function writeNativePackage(result: EmitResult, outDir: string, options: { inputsKey?: string } = {}): WriteResult {
  const rt = runtimeDir();
  const want = new Map<string, string | Buffer>();
  const copyTree = (from: string, to: string, filter: (f: string) => boolean) => {
    for (const f of listFiles(from)) {
      if (!filter(f)) continue;
      want.set(path.join(to, path.relative(from, f)), fs.readFileSync(f));
    }
  };
  copyTree(path.join(rt, "cpp/lucent"), path.join(outDir, "cpp/lucent"), () => true);
  copyTree(path.join(rt, "cpp/rn"), path.join(outDir, "cpp/rn"), () => true);
  copyTree(path.join(rt, "cpp/third_party"), path.join(outDir, "cpp/third_party"), () => true);
  copyTree(path.join(rt, "native"), outDir, () => true);
  for (const [name, content] of result.files) want.set(path.join(outDir, "cpp/generated", name), content);
  for (const [name, content] of result.proxies) want.set(path.join(outDir, "js", `${name}.js`), content);
  want.set(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ generator: "lucent", modules: [...result.proxies.keys()].sort(), inputs: options.inputsKey }, null, 2) + "\n",
  );

  const existing = new Set(listFiles(outDir));
  const before = new Set(existing);
  const written: string[] = [];
  let unchanged = 0;
  for (const [file, content] of want) {
    existing.delete(file);
    const buf = typeof content === "string" ? Buffer.from(content) : content;
    if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    written.push(file);
  }
  const removed: string[] = [];
  for (const stale of existing) {
    fs.rmSync(stale);
    removed.push(stale);
  }
  return {
    outDir,
    written,
    unchanged,
    removed,
    structureChanged: removed.length > 0 || written.some((f) => !before.has(f)),
  };
}

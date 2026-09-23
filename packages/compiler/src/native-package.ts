import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EmitResult } from "./emit/index.ts";

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
export function writeNativePackage(result: EmitResult, outDir: string): WriteResult {
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
    JSON.stringify({ generator: "lucent", modules: [...result.proxies.keys()].sort() }, null, 2) + "\n",
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

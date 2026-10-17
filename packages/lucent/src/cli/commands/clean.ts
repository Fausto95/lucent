import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_ENTRIES, cacheRoot, pruneStaleCache } from "@lucent-lang/bindgen";
import type { Invocation } from "../args.ts";

/** Bytes under `dir`. */
function size(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(dir).reduce((n, e) => n + size(path.join(dir, e)), 0);
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/**
 * `lucent clean`: removes .lucent/ (the next build starts over); --cache
 * also the cache Lucent shares between projects, each of its entries
 * (CACHE_ENTRIES: SDK bindings, memos, compiled Swift modules and
 * packages, declarations, compiled Kotlin and Java), or with --stale only
 * what other Lucent versions wrote to it (this one never reads it).
 */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;
  const removed: { path: string; bytes: number }[] = [];
  const generated = path.join(root, ".lucent");
  if (fs.existsSync(generated)) {
    const freed = size(generated);
    fs.rmSync(generated, { recursive: true, force: true });
    removed.push({ path: ".lucent", bytes: freed });
    out.print(`${t.success(t.symbols.ok)} removed .lucent  ${t.dim(mb(freed))}`);
  } else out.print(`${t.dim(t.symbols.off)} nothing to remove in the project`);
  if (flags.cache && flags.stale) {
    const pruned = pruneStaleCache();
    const freed = pruned.reduce((n, p) => n + p.bytes, 0);
    removed.push(...pruned);
    out.print(
      pruned.length
        ? `${t.success(t.symbols.ok)} removed ${pruned.length} SDK cache ${pruned.length === 1 ? "entry" : "entries"} other Lucent versions wrote  ${t.dim(mb(freed))}`
        : `${t.dim(t.symbols.off)} nothing stale in the SDK cache`,
    );
  } else if (flags.cache) {
    // Its entries alone: LUCENT_CACHE_DIR may name a directory that holds more.
    const root = cacheRoot();
    let freed = 0;
    for (const entry of CACHE_ENTRIES) {
      const dir = path.join(root, entry);
      if (!fs.existsSync(dir)) continue;
      const bytes = size(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push({ path: dir, bytes });
      freed += bytes;
    }
    out.print(
      `${t.success(t.symbols.ok)} removed the cache  ${t.dim(`${mb(freed)}, ${root.replace(os.homedir(), "~")}; SDK bindings, compiled Swift and Kotlin and generated declarations are made again on first use`)}`,
    );
  }
  if (out.json) out.data({ removed });
  return 0;
}

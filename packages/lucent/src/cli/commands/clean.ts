import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Invocation } from "../args.ts";

/** Bytes under `dir`. */
function size(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(dir).reduce((n, e) => n + size(path.join(dir, e)), 0);
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** `lucent clean`: removes .lucent/ (the next build starts over); --cache also the SDK cache. */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;
  const generated = path.join(root, ".lucent");
  if (fs.existsSync(generated)) {
    const freed = size(generated);
    fs.rmSync(generated, { recursive: true, force: true });
    out.print(`${t.success(t.symbols.ok)} removed .lucent  ${t.dim(mb(freed))}`);
  } else out.print(`${t.dim(t.symbols.off)} nothing to remove in the project`);
  if (flags.cache) {
    const cache = path.join(process.env.LUCENT_CACHE_DIR || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "lucent"), "sdk");
    const freed = size(cache);
    fs.rmSync(cache, { recursive: true, force: true });
    out.print(`${t.success(t.symbols.ok)} removed the SDK cache  ${t.dim(`${mb(freed)}, ${cache.replace(os.homedir(), "~")}; SDK modules are extracted again on first use`)}`);
  }
  return 0;
}

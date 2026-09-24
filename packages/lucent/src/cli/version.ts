import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let found: { dir: string; version: string } | undefined;

/** @lucent-lang/lucent's directory and version: its package.json is above this file, in the sources and in dist/. */
function lucentPackage(): { dir: string; version: string } {
  if (found) return found;
  for (
    let dir = path.dirname(fileURLToPath(import.meta.url));
    path.dirname(dir) !== dir;
    dir = path.dirname(dir)
  ) {
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string };
    if (pkg.name === "@lucent-lang/lucent")
      return (found = { dir, version: pkg.version ?? "0.0.0" });
  }
  throw new Error("lucent is not inside the @lucent-lang/lucent package");
}

export function version(): string {
  return lucentPackage().version;
}

/** A file shipped in @lucent-lang/lucent (gradle/, schemas/, …). */
export function packageFile(relative: string): string {
  return path.join(lucentPackage().dir, relative);
}

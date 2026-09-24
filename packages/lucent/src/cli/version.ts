import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @lucent-lang/lucent's version: its package.json is above this file, in the sources and in dist/. */
export function version(): string {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string; version?: string };
    if (pkg.name === "@lucent-lang/lucent") return pkg.version ?? "0.0.0";
  }
  return "0.0.0";
}

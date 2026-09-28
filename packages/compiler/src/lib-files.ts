/**
 * Where the compiler's lib/ files are, from its code: beside src/ in the
 * repository, beside dist/ in the published package (this file stays at
 * the top of either).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A file of lib/sdk: declarations, and the bindings Lucent ships. */
export function sdkLibFile(name: string): string {
  return path.resolve(here, `../lib/sdk/${name}`);
}

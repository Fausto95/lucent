import { readFileSync } from "node:fs";

/**
 * Podspec, Gradle and other hand-written build files live in `native/` as real
 * source rather than TypeScript string literals, so editors and formatters can
 * read them. Host-supplied fragments arrive through `{{token}}` placeholders.
 */
export const nativeAsset = (file: string): string =>
  readFileSync(new URL(`../native/${file}`, import.meta.url), "utf8");

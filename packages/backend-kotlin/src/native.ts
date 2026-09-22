import { readFileSync } from "node:fs";

/**
 * Hand-written Kotlin lives in `native/` as real source, not TypeScript string
 * literals: editors highlight it, formatters reach it, `kotlinc` checks it
 * directly, and JSON/string escapes stop needing a second layer of backslashes.
 */
export const nativeKotlin = (file: string): string =>
  readFileSync(new URL(`../native/${file}`, import.meta.url), "utf8");

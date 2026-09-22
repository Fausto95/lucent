import { readFileSync } from "node:fs";

/**
 * Hand-written Swift lives in `native/` as real source, not TypeScript string
 * literals: editors highlight it, formatters reach it, and `swiftc` checks it
 * directly. Read eagerly — these are a few kilobytes read once per build.
 */
export const nativeSwift = (file: string): string =>
  readFileSync(new URL(`../native/${file}`, import.meta.url), "utf8");

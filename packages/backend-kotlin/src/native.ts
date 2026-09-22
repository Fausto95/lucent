/**
 * Hand-written Kotlin lives in `native/` as real source, not TypeScript string
 * literals: editors highlight it, formatters reach it, `kotlinc` checks it
 * directly, and JSON escapes stop needing a second layer of backslashes. It is
 * embedded rather than read back, because a bundled host resolves a runtime
 * path beside the bundle instead of into this package.
 */
export { nativeSource as nativeKotlin } from "./native-sources.generated.ts";

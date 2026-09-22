/**
 * Hand-written Swift lives in `native/` as real source, not TypeScript string
 * literals: editors highlight it, formatters reach it, and `swiftc` checks it
 * directly. It is embedded rather than read back, because a bundled host
 * resolves a runtime path beside the bundle instead of into this package.
 */
export { nativeSource as nativeSwift } from "./native-sources.generated.ts";

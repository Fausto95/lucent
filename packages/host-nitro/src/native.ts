/**
 * Podspec, Gradle, CMake and other hand-written build files live in `native/`
 * as real source rather than TypeScript string literals, so editors and
 * formatters can read them. Host-supplied fragments arrive through `{{token}}`
 * placeholders. They are embedded rather than read back, because `vp pack`
 * bundles this host and a runtime path would then resolve beside the bundle.
 */
export { nativeSource as nativeAsset } from "./native-sources.generated.ts";

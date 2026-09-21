import { defineConfig } from "tsdown";

/**
 * Bundles the entry points that Node (Metro workers, expo prebuild, npx) loads
 * into CommonJS. Sources stay the entry for vitest and tsc.
 */
const shared = {
  format: "cjs" as const,
  platform: "node" as const,
  target: "node22",
  external: ["oxc-parser", "@oxc-project/types", "@expo/config-plugins", "expo/config-plugins"],
  dts: false,
  clean: true,
  outExtensions: () => ({ js: ".cjs" }),
};

export default defineConfig([
  {
    ...shared,
    entry: { transformer: "packages/metro/src/transformer.ts", index: "packages/metro/src/index.ts" },
    outDir: "packages/metro/dist",
  },
  { ...shared, entry: { plugin: "packages/expo/src/plugin.ts" }, outDir: "packages/expo/dist" },
  { ...shared, entry: { main: "packages/cli/src/main.ts" }, outDir: "packages/cli/dist" },
]);

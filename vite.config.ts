import { defineConfig } from "vite-plus";

/** Options shared by every Node-loaded bundle (Metro workers, expo prebuild, npx). Sources stay the entry for tests and tsc. */
const pack = {
  format: "cjs" as const,
  platform: "node" as const,
  target: "node22",
  external: ["oxc-parser", "@oxc-project/types", "@expo/config-plugins", "expo/config-plugins"],
  dts: false,
  clean: true,
  outExtensions: () => ({ js: ".cjs" }),
};

// Lucent function decorators are parsed by our compiler, not the JS lint/format parser.
const generated = [
  "**/*.lucent.ts",
  "**/*.lucent.tsx",
  "fixtures/**",
  "apps/**/ios/**",
  "apps/**/android/**",
  "apps/**/modules/**",
  "**/.lucent/**",
  "apps/website/**",
];

export default defineConfig({
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "import"],
    categories: { correctness: "error", suspicious: "error", perf: "warn" },
    rules: {
      "no-unused-vars": "error",
      "typescript/no-explicit-any": "error",
      "typescript/consistent-type-imports": "error",
      "import/no-cycle": "error",
      "no-console": "off",
      "no-await-in-loop": "off",
    },
    ignorePatterns: generated,
  },
  fmt: {
    printWidth: 120,
    ignorePatterns: generated,
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
  pack: [
    {
      ...pack,
      entry: {
        transformer: "packages/metro/src/transformer.ts",
        index: "packages/metro/src/index.ts",
      },
      outDir: "packages/metro/dist",
    },
    { ...pack, entry: { plugin: "packages/expo/src/plugin.ts" }, outDir: "packages/expo/dist" },
    { ...pack, entry: { main: "packages/cli/src/main.ts" }, outDir: "packages/cli/dist" },
  ],
});

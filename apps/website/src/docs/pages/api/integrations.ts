import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/integrations",
  title: "Metro & Expo plugins",
  description: "`@lucent-lang/core/metro` swaps Lucent files for their proxies at bundle time. `@lucent-lang/core/expo` runs the native build during prebuild.",
  blocks: [
    { kind: "h2", text: "@lucent-lang/core/metro" },
    {
      kind: "code",
      filename: "declaration",
      code: 'export type HostName = "expo" | "nitro";\nexport interface LucentMetroOptions {\n  host?: HostName; // default "expo"\n}\nexport function withLucent<C>(config: C, options?: LucentMetroOptions): C;',
    },
    {
      kind: "code",
      filename: "metro.config.js",
      code: 'const { getDefaultConfig } = require("expo/metro-config");\nconst { withLucent } = require("@lucent-lang/core/metro");\n\nmodule.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });',
    },
    {
      kind: "list",
      items: [
        "Sets `transformer.babelTransformerPath` to Lucent's bundled transformer and remembers the upstream one (Expo's or React Native's) so every other file passes straight through.",
        "For a file matching `/\\.lucent\\.tsx?$/`, compiles in-process, replaces the source with the host's JS proxy, and delegates. Compile errors surface as Metro transform errors with the Lucent code frame.",
        "`getCacheKey()` combines the upstream key, the compiler version and the host, so changing either invalidates Metro's cache.",
        "Host and upstream path reach Metro's worker processes through the `LUCENT_HOST` and `LUCENT_UPSTREAM_TRANSFORMER` environment variables.",
        "The transformer resolves `lucent.config.ts` by walking up from the source file to the nearest config or `package.json`.",
      ],
    },
    { kind: "h2", text: "@lucent-lang/core/expo" },
    {
      kind: "code",
      filename: "declaration",
      code: 'export interface LucentPluginProps {\n  host?: "expo" | "nitro"; // default "expo"\n}',
    },
    {
      kind: "code",
      filename: "app.json",
      code: '{\n  "expo": {\n    "plugins": [["@lucent-lang/core/expo", { "host": "expo" }]]\n  }\n}',
    },
    {
      kind: "list",
      items: [
        "A `createRunOncePlugin` config plugin. During `expo prebuild` it runs the same `build()` as the CLI for iOS and Android (skipped under `introspect`), failing prebuild on any error and printing warnings.",
        "Merges the generated capability configuration into the app: Info.plist usage descriptions, entitlements, and Android `uses-permission` entries, without touching unrelated settings.",
        "Generated code lands in `modules/lucent/`, which Expo autolinks. Add it to `.gitignore` or commit it; both work.",
      ],
    },
    {
      kind: "note",
      text: "Both plugins need the packages' built CommonJS bundles (`pnpm build:packages` in the repository). Sources stay the entry for tests and type-checking.",
    },
  ],
};

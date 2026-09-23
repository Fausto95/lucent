import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "reference/cli",
  title: "CLI",
  description: "The `lucent` command from @lucent-lang/cli: build, check and init.",
  blocks: [
    {
      kind: "p",
      text: "Install `@lucent-lang/cli` as a dev dependency. It provides one command, `lucent`, with three subcommands. Every subcommand finds the `*.lucent.ts` files under the root directory, skipping `node_modules`, `ios`, `android` and dot-directories.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: `lucent build [--root <dir>] [--out <dir>] [--force] [--platforms ios,android,host]
lucent build --watch [--root <dir>]
lucent check [--root <dir>]
lucent init  [--root <dir>]`,
    },
    { kind: "h2", text: "lucent build" },
    {
      kind: "p",
      text: "Compiles every module and writes the native package that React Native autolinks: the C++ runtime, the generated C++, the build files (podspec, CMake), and one JavaScript proxy per module.",
    },
    {
      kind: "table",
      head: ["Flag", "Default", "Meaning"],
      rows: [
        ["`--root <dir>`", "the current directory", "Where to look for `*.lucent.ts` files."],
        ["`--out <dir>`", "`<root>/.lucent/native`", "Where to write the native package. Metro and `react-native.config.js` expect the default."],
        ["`--force`", "off", "Build even if nothing changed since the last build."],
        [
          "`--platforms <list>`",
          "`ios,android`",
          "Targets for [platform modules](/docs/platform-apis/). `host` builds stubs whose platform exports throw \"not available on this platform\", for tests and tools.",
        ],
        ["`--watch`", "off", "Build, then rebuild whenever a `*.lucent.ts` file changes. Runs until stopped."],
      ],
    },
    {
      kind: "code",
      filename: "terminal",
      code: `$ npx lucent build
✓ Compiled 3 module(s): counter, geometry, text (412 ms)
  .lucent/native: 9 written, 31 unchanged, 0 removed

$ npx lucent build
✓ .lucent/native is up to date (3 module(s), 4 ms)`,
    },
    {
      kind: "list",
      items: [
        "The build is skipped when the sources have not changed since the last one, unless `--force`.",
        "Only files whose contents changed are rewritten, so Xcode and Gradle rebuild only what they must.",
        "When native files are added or removed, the build says so: run `pod install` before the next iOS build.",
        "On any diagnostic, nothing is written and the command exits with status 1. Diagnostics use the format `file:line:column: LUCENT1234: message` (see [Diagnostics](/docs/language/diagnostics/)).",
      ],
    },
    {
      kind: "p",
      text: "In watch mode, a failed build prints the diagnostics and keeps watching. When a rebuild changes native files (anything but the proxies), it reminds you to rebuild the app in Xcode or Gradle. You rarely need to start it yourself: [`withLucent`](/docs/reference/metro/) runs it inside the Metro dev server.",
    },
    { kind: "h2", text: "lucent check" },
    {
      kind: "p",
      text: "Type-checks and validates every module, as `build` does, without writing anything. Use it in CI or a pre-commit hook. It exits with status 1 on any diagnostic.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: `$ npx lucent check
✓ 3 module(s) OK: counter, geometry, text (380 ms)`,
    },
    { kind: "h2", text: "lucent init" },
    {
      kind: "p",
      text: "Wires an existing React Native app. It is safe to run more than once.",
    },
    {
      kind: "list",
      items: [
        "Writes `react-native.config.js` with a `lucent-native` dependency pointing at `.lucent/native`, so autolinking picks up the generated package. If the file exists without that entry, it prints the entry for you to add.",
        "Adds `.lucent/` to `.gitignore`: the native package is generated, like a build output.",
        "Prints the remaining steps: wrap the Metro config with [`withLucent()`](/docs/reference/metro/), and enable `\"noUncheckedIndexedAccess\": true` in `tsconfig.json` so your editor checks what the compiler checks.",
      ],
    },
    {
      kind: "code",
      filename: "react-native.config.js",
      code: `module.exports = {
  dependencies: {
    "lucent-native": { root: require("path").join(__dirname, ".lucent", "native") },
  },
};`,
    },
    {
      kind: "p",
      text: "Expo apps don't need `lucent init`: the [Expo plugin](/docs/reference/expo/) writes the same entry during prebuild. A full walkthrough is in [Getting started](/docs/getting-started/).",
    },
  ],
};

import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/cli",
  title: "CLI",
  description:
    "`lucent` builds, checks, scaffolds, diagnoses and extracts SDK bindings. Run it from the app root, or with `npx @lucent-lang/cli` without installing anything.",
  blocks: [
    {
      kind: "code",
      filename: "terminal",
      code: "npx @lucent-lang/cli init      # wire an Expo or bare React Native app\nnpx @lucent-lang/cli doctor    # check the toolchain and the wiring\n\nlucent build [--host expo|nitro] [--out <dir>] [--emit-ir] [--force] [--no-postgen] [--watch] [files…]\nlucent check [--watch] [files…]\nlucent init [--host expo|nitro] [--yes]\nlucent doctor [--host expo|nitro]\nlucent explain [code]\nlucent ir <file>\nlucent clean [--out <dir>] [--dry-run]\nlucent sdk swift <file.swiftinterface> --module <Module> --out <dir>\nlucent sdk android <javap.txt> --out <dir>\nlucent sdk android - --classpath <android.jar> --class <qualified.Class> --out <dir>",
    },
    {
      kind: "p",
      text: "`npx @lucent-lang/cli <command>` fetches the latest release. Inside a project that lists `@lucent-lang/cli` as a dev dependency, `npx lucent <command>` runs the local copy. Every command accepts `--help`; `lucent help <command>` shows its flags and examples.",
    },
    { kind: "h2", text: "Global options" },
    {
      kind: "table",
      head: ["Flag", "Effect"],
      rows: [
        [
          "`--json`",
          "Machine-readable output on stdout for `build`, `check`, `doctor`, `explain`, `ir`, `clean` and `--version`. Progress lines are suppressed; diagnostics travel inside the JSON.",
        ],
        ["`--quiet`, `-q`", "Only errors are printed."],
        [
          "`--no-color`",
          "Plain text. `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and `CI` are honored; a pipe gets no color unless forced.",
        ],
        ["`--no-emoji`", "ASCII glyphs instead of emoji. `NO_EMOJI` does the same."],
        ["`--host expo|nitro`", "Override the host. Otherwise `react-native-nitro-modules` in `package.json` means Nitro and `expo` means Expo."],
        ["`--version`, `-v`", "CLI, compiler and Node versions."],
      ],
    },
    {
      kind: "note",
      text: "Mistyped commands and flags get a suggestion (`Unknown command \"buidl\". Did you mean \"build\"?`), and every failure exits with code 1.",
    },
    { kind: "h2", text: "lucent build" },
    {
      kind: "p",
      text: "Discovers every `*.lucent.ts` and `*.lucent.tsx` under the project (or takes explicit files), resolves imports between them, compiles, and writes the native package. Diagnostics are printed as colored code frames; exit code 1 on any error.",
    },
    {
      kind: "table",
      head: ["Flag", "Effect"],
      rows: [
        ["`--host expo` / `nitro`", "Target Expo Modules or Nitro. Output goes to `modules/lucent/` or `.lucent/nitro/`."],
        ["`--out <dir>`", "Write the package somewhere else."],
        ["`--watch`, `-w`", "Rebuild whenever a Lucent file, `lucent.config.*` or a library manifest changes."],
        ["`--emit-ir`", "Also write each module's IR text to `.lucent/ir/`."],
        ["`--force`, `-f`", "Ignore `.lucent/cache.json` and recompile everything."],
        ["`--no-postgen`", "Skip the host's post-generate step (nitrogen for Nitro)."],
      ],
    },
    {
      kind: "code",
      filename: "output",
      code: "🔨 lucent build (expo)\n⚙️ src/geo.lucent.ts compiled\n📦 src/people.lucent.ts cached\n\n✅ 1 compiled · 1 cached → modules/lucent (38 ms)\n💡 Next: npx expo prebuild, then npx expo run:ios (or run:android).",
    },
    {
      kind: "list",
      items: [
        "The cache key is `SHA256(compilerVersion + host + source)` plus the hashes of imported files and bindings.",
        "Output files are rewritten only when their contents change. A generated-file manifest (`.lucent-files.json`) keeps native build products during regeneration.",
        "Source basenames must be unique within one build.",
        "`--json` prints `{ ok, host, outDir, compiled, cached, diagnostics, durationMs }`.",
      ],
    },
    { kind: "h2", text: "lucent check" },
    {
      kind: "p",
      text: "Type-checks without generating. Also verifies that every capability a module needs is present in `lucent.config.ts`. Prints one line per file (✅ clean, ⚠️ warnings, ❌ errors) followed by the code frames and a tally. `--watch` re-checks on change.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: 'lucent check --json\n# { "ok": false, "files": [{ "file": "src/geo.lucent.ts", "ok": false,\n#     "diagnostics": [{ "code": "LC1014", "severity": "error", "message": "…", "line": 4, "column": 14, "help": "…" }] }],\n#   "durationMs": 12 }',
    },
    { kind: "h2", text: "lucent init" },
    {
      kind: "p",
      text: "Wires the app in the current directory. The host comes from `--host`, then from `package.json`; on a terminal with neither it asks. `--yes` skips the prompt and defaults to Expo. Running it again changes nothing and says so.",
    },
    {
      kind: "table",
      head: ["File", "Change"],
      rows: [
        [
          "`package.json`",
          "Adds `@lucent-lang/runtime`, `@lucent-lang/types`, `@lucent-lang/config`, `@lucent-lang/metro`, plus `@lucent-lang/expo` (Expo) or `react-native-nitro-modules`, `nitrogen`, `@lucent-lang/cli` and the `lucent-native` link (Nitro). Lucent packages are pinned to the CLI's version.",
        ],
        ["`lucent.config.ts`", "Written if no config exists, with an empty `capabilities` map to fill in."],
        ["`src/math.lucent.ts`", "A starter module, unless the project already has Lucent files."],
        ["`metro.config.js`", "Written if missing. An existing config is left alone with a note showing the `withLucent` wrapper to add."],
        ["`app.json`", "Expo: appends `[\"@lucent-lang/expo\", { \"host\": \"expo\" }]` to `expo.plugins`."],
        ["`react-native.config.js`", "Nitro: written if missing, linking `.lucent/nitro` as `lucent-native`."],
      ],
    },
    {
      kind: "p",
      text: "It ends with the next steps for your package manager (detected from the lockfile): install, prebuild or `lucent build --host nitro`, run the app, `lucent doctor`.",
    },
    { kind: "h2", text: "lucent doctor" },
    {
      kind: "p",
      text: "Two sections. **Toolchain**: Node 22.12+, the package manager, `swiftc` and `kotlinc` (required), `xcodebuild`, `java`, `adb` and `pod` (optional). **Project**: `package.json`, the detected host, the Lucent dependencies, `withLucent` in the Metro config, the Expo plugin or the Nitro autolink and `nitrogen`, `lucent.config.*`, the number of Lucent files, and capabilities used but not declared. Each problem comes with the command or snippet that fixes it. Exit code 1 when anything required is missing.",
    },
    {
      kind: "code",
      filename: "output",
      code: "🩺 lucent doctor\n\nToolchain\n  ✅ node             v24.16.0\n  ✅ package manager  pnpm\n  ✅ swiftc           Apple Swift version 6.2\n  ❌ kotlinc          not found\n                     💡 brew install kotlin\n  ⏭️ adb              not found (optional)\n\nProject (expo)\n  ✅ package.json     my-app\n  ✅ metro config     metro.config.js uses withLucent\n  ❌ expo plugin      app.json is missing @lucent-lang/expo\n                     💡 Add [\"@lucent-lang/expo\", { \"host\": \"expo\" }] to expo.plugins; lucent init does this\n  ❌ capabilities     missing clock\n                     💡 Declare them in lucent.config.ts: capabilities: { clock: true }\n\n❌ 3 problems. Fix the items marked above and run again.",
    },
    { kind: "h2", text: "lucent explain" },
    {
      kind: "p",
      text: "`lucent explain LC1004` prints the code's title, its family (language, platform, or warning) and a link to the [diagnostics reference](/docs/language/diagnostics/). Without a code it lists every diagnostic Lucent can report. Codes are case-insensitive and a near miss gets a suggestion.",
    },
    { kind: "h2", text: "lucent ir" },
    {
      kind: "p",
      text: "`lucent ir src/geo.lucent.ts` compiles one file and prints its typed [intermediate representation](/docs/how-it-works/) as text, or as the IR module JSON with `--json`. Useful when a generated Swift or Kotlin body is not what you expected.",
    },
    { kind: "h2", text: "lucent clean" },
    {
      kind: "p",
      text: "Removes `.lucent/cache.json`, `.lucent/ir/` and the generated package (`modules/lucent/` or `.lucent/nitro/`, or `--out`). `--dry-run` lists what would go.",
    },
    { kind: "h2", text: "lucent sdk" },
    {
      kind: "p",
      text: "Generates a [library manifest](/docs/api/library-manifest/) from platform SDK interfaces. Writes `schema.json` (versioned, with extraction diagnostics), `library.json` (the bindings) and `index.d.ts` (editor declarations) to `--out`.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: "lucent sdk swift Foundation.swiftinterface --module Foundation --out sdk/foundation\nlucent sdk android - --classpath $ANDROID_HOME/platforms/android-35/android.jar --class java.lang.Math --out sdk/math",
    },
    {
      kind: "list",
      items: [
        "Swift: single-line public free functions. Parameter labels and `throws` are kept.",
        "Android: public static methods, via `javap -public`. Pass a saved javap listing instead of `-` to skip running javap.",
        "Supported scalar types: `Double`/`double`, `String`, `Bool`/`boolean`, `Int32`/`int`, `void`. Overloads, instance methods, callbacks, generics and availability-gated declarations are reported in `schema.json` and omitted.",
      ],
    },
    { kind: "h2", text: "Programmatic use" },
    {
      kind: "code",
      filename: "build.ts",
      code: 'import { build } from "@lucent-lang/cli";\n\nconst result = await build({ root: process.cwd(), host: "expo", emitIR: true, log: console.log });\n// result: { ok, outDir, compiled, cached, diagnostics: { severity, fileName, rendered }[] }',
    },
  ],
};

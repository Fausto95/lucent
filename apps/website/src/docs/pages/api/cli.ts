import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/cli",
  title: "CLI",
  description: "`lucent` compiles, checks, scaffolds, and extracts SDK bindings. Run it from the app root.",
  blocks: [
    {
      kind: "code",
      filename: "terminal",
      code: "lucent build [--host expo|nitro] [--out <dir>] [--emit-ir] [--force] [--no-postgen] [files…]\nlucent check [files…]\nlucent init [--host expo|nitro]\nlucent sdk swift <file.swiftinterface> --module <Module> --out <dir>\nlucent sdk android <javap.txt> --out <dir>\nlucent sdk android - --classpath <android.jar> --class <qualified.Class> --out <dir>",
    },
    { kind: "h2", text: "lucent build" },
    {
      kind: "p",
      text: "Discovers every `*.lucent.ts` and `*.lucent.tsx` under the project (or takes explicit files), resolves imports between them, compiles, and writes the native package. Exit code 1 on any error; diagnostics are printed with code frames.",
    },
    {
      kind: "table",
      head: ["Flag", "Effect"],
      rows: [
        ["`--host expo` (default) / `nitro`", "Target Expo Modules or Nitro. Output goes to `modules/lucent/` or `.lucent/nitro/`."],
        ["`--out <dir>`", "Write the package somewhere else."],
        ["`--emit-ir`", "Also write each module's IR text to `.lucent/ir/`."],
        ["`--force`", "Ignore `.lucent/cache.json` and recompile everything."],
        ["`--no-postgen`", "Skip the host's post-generate step (nitrogen for Nitro)."],
      ],
    },
    {
      kind: "code",
      filename: "output",
      code: "⚙ compiling src/geo.lucent.ts\n✓ cached src/people.lucent.ts\n\n1 compiled, 1 cached → modules/lucent",
    },
    {
      kind: "list",
      items: [
        "The cache key is `SHA256(compilerVersion + host + source)` plus the hashes of imported files and bindings.",
        "Output files are rewritten only when their contents change. A generated-file manifest (`.lucent-files.json`) keeps native build products during regeneration.",
        "Source basenames must be unique within one build.",
      ],
    },
    { kind: "h2", text: "lucent check" },
    {
      kind: "p",
      text: "Type-checks without generating. Also verifies that every capability a module needs is present in `lucent.config.ts`. Prints `✓ file` per clean module.",
    },
    { kind: "h2", text: "lucent init" },
    {
      kind: "p",
      text: "Adds the host's dependencies to `package.json` (`@lucent-lang/runtime`, `@lucent-lang/types`, and for Nitro `react-native-nitro-modules` plus `nitrogen`) and writes a starter `src/math.lucent.ts` if none exists. Run your package manager's install afterwards.",
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

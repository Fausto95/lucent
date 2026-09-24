import { cliCommands, globalFlags } from "../../../generated/cli";
import type { Block, DocPage } from "../../types";

/** What the command table cannot say: examples and details, by command. */
const notes: Record<string, Block[]> = {
  build: [
    {
      kind: "code",
      filename: "terminal",
      code: `$ npx lucent build
◆ lucent 0.0.4

✓ SDK bindings  UIKit · Foundation · android.os    cached
✓ Checked 3 modules                     412 ms
✓ Generated C++  1 changed, 2 cached    38 ms
✓ Native package  .lucent/native

modules  geo       shared
         haptics   ios android
next     rebuild the app`,
    },
    {
      kind: "list",
      items: [
        "In a terminal the running step is shown live; in CI and pipes each step prints one line when it finishes.",
        "Nothing changed since the last build: it says up to date and does nothing, unless `--force`. Only files whose contents changed are rewritten, so Xcode and Gradle rebuild only what they must.",
        "`next` says what the app needs: a rebuild (with `pod install` first when native files were added or removed), a reload, or nothing.",
        "`--platforms host` builds stubs whose platform exports throw, for tests and tools. On a problem nothing is written and the exit code is 1; `--json` prints the result as a [documented JSON document](https://github.com/Fausto95/lucent/tree/main/packages/lucent/schemas).",
      ],
    },
  ],
  check: [
    {
      kind: "code",
      filename: "terminal",
      code: `$ npx lucent check

  error LUCENT3006  UIDevice can only be used on the main thread: call it inside main(() => …) from lucent:thread

    src/device.ios.lucent.ts:4:10
    3 │ export async function model(): Promise<string> {
    4 │   return UIDevice.current.model;
      │          ^^^^^^^^
    5 │ }

  fix  wrap the call in main(() => …) from lucent:thread
  docs lucent explain LUCENT3006

  1 error · 3 modules · 0.4 s`,
    },
    { kind: "p", text: "Use it in CI or a pre-commit hook. A passing check is remembered under the same inputs as the build, so checking an unchanged project takes a fraction of a second." },
  ],
  dev: [
    {
      kind: "code",
      filename: "terminal",
      code: `$ npx lucent dev
◆ lucent dev   watching .

MODULE     IOS   ANDROID   LAST BUILD
geo        ●     ●         12:04:31  38 ms
haptics    ●     ✗         12:04:31  38 ms

─ problems (1) ───────────────────────────────
› src/haptics.android.lucent.ts:8  LUCENT3004  …
  fix  …

[r] rebuild  [c] clear cache  [d] doctor  [o] open  [q] quit`,
    },
    {
      kind: "p",
      text: "Arrows select a problem and `o` opens it in `$VISUAL` or `$EDITOR` at its line. Outside a terminal, and with `--compact`, it prints one line per build instead: that is what [`withLucent`](/docs/reference/metro/) runs next to the Metro dev server, without taking Metro's keys.",
    },
  ],
  init: [
    {
      kind: "p",
      text: "It detects a bare or an Expo app and the package manager, shows each change as a diff and applies the ones you confirm (`--yes`: all of them). It wraps the Metro config with `withLucent`, adds the config plugin (Expo) or the Lucent Gradle task and `react-native.config.js` entry (bare), maps `lucent:*` and turns on `noUncheckedIndexedAccess` in `tsconfig.json`, ignores `.lucent/`, and scaffolds `src/hello.lucent.ts` in a project without a module. It ends with the command to run next, and changes nothing when run again.",
    },
  ],
  doctor: [{ kind: "p", text: "Each check passes, warns or fails with the fix; the exit code is 1 when one fails. It does not load the compiler, so it answers even when the project does not build." }],
  explain: [{ kind: "p", text: "Prints what the [Diagnostics](/docs/language/diagnostics/) page says about a code: why it exists, the fix, and a wrong and a right example. `lucent explain 3006` works too." }],
  bench: [
    {
      kind: "code",
      filename: "src/geo.bench.ts",
      code: `import { nearest } from "./geo.lucent";

const points = Array.from({ length: 2000 }, (_, i) => ({ x: i % 101, y: i % 97 }));

export default {
  nearest: () => nearest(points, { x: 50, y: 50 }),
};`,
    },
    { kind: "p", text: "Each case runs as your module compiled to C++ and as the same TypeScript run as JavaScript, in one desktop Hermes (build one, or set `HERMES_DIR`); results must match. Devices are slower or faster in absolute terms, but the speedup carries over." },
  ],
};

export const page: DocPage = {
  slug: "reference/cli",
  title: "CLI",
  description: "The `lucent` command from @lucent-lang/lucent: every subcommand and flag.",
  blocks: [
    {
      kind: "p",
      text: "`@lucent-lang/lucent` provides one command, `lucent`. Every subcommand finds the `*.lucent.ts` files under the project directory (skipping `node_modules`, `ios`, `android` and dot-directories), and the ones of the Lucent packages it depends on. Run with no subcommand in a terminal, it opens `lucent dev` in a Lucent project and `lucent init` elsewhere. This page is generated from the same command table as `lucent --help`.",
    },
    { kind: "table", head: ["Command", "What it does"], rows: cliCommands.map((c) => [`[\`lucent ${c.name}\`](#lucent-${c.name.replace(/ /g, "-")})`, c.summary]) },
    { kind: "h3", text: "Flags every command takes" },
    { kind: "table", head: ["Flag", "Meaning"], rows: globalFlags.map((f) => [`\`${f.flag}\``, f.description]) },
    { kind: "p", text: "Output is coloured and animated only in a terminal; `NO_COLOR`, `FORCE_COLOR`, `CI` and `TERM=dumb` are respected, and output fits 80 columns." },
    ...cliCommands.flatMap((c): Block[] => [
      { kind: "h2", text: `lucent ${c.name}` },
      { kind: "p", text: c.summary },
      ...(c.flags.length ? [{ kind: "table" as const, head: ["Flag", "Meaning"], rows: c.flags.map((f) => [`\`${f.flag}\``, f.description]) }] : []),
      ...(notes[c.name] ?? []),
    ]),
  ],
};

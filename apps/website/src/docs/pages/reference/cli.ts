import { cliCommands, globalFlags } from "../../../generated/cli";
import type { Block } from "../../types";

/** What the command table cannot say: examples and details, by command. */
const notes: Record<string, Block[]> = {
  build: [
    {
      kind: "code",
      filename: "terminal",
      copy: false,
      code: `◆ lucent 0.0.3

✓ SDK bindings  CoreLocation · android.location · android.os  cached
✓ Checked 2 modules                     733 ms
✓ Generated C++  2 changed              24 ms
✓ Native package  .lucent/native

modules  trip-tracker/location  ios android
         trip-tracker/trip      shared
next     rebuild the app (iOS: pod install first)`,
    },
    {
      kind: "list",
      items: [
        "When nothing changed since the last build, it says so and writes nothing, unless `--force`. Otherwise it rewrites only the files whose content changed.",
        "`next` says what the app needs: a rebuild (after `pod install` when files were added or removed), a reload, or nothing.",
        "A platform whose SDK isn't installed is skipped, with a warning. `--platforms host` builds stubs whose platform code throws, for tests.",
        "On a problem, nothing is written and the exit code is 1.",
      ],
    },
  ],
  check: [
    {
      kind: "p",
      text: "It reports problems as the [diagnostics](/docs/reference/diagnostics/) page shows them, and writes nothing. A pass is remembered, so checking an unchanged project takes a fraction of a second. Use it in CI.",
    },
  ],
  dev: [
    {
      kind: "code",
      filename: "terminal",
      copy: false,
      code: `[14:02:11] ✓ 2 modules  36 ms · rebuild the app
[14:03:40] ✗ 1 error
  src/greet.lucent.ts:1:23  LUCENT2001  \`any\` has no native representation; give this value a concrete type
    fix: use a concrete type, a union, or a generic parameter`,
    },
    {
      kind: "p",
      text: "In a terminal, it shows a dashboard of modules, platforms and problems. Its keys rebuild (`r`), clear the cache (`c`), run the doctor (`d`), open a problem in your editor (`o`) and quit (`q`). With `--compact`, or outside a terminal, it prints one line per build, as above: that's what [`withLucent`](/docs/reference/metro-and-expo/) runs next to Metro.",
    },
  ],
  init: [
    {
      kind: "p",
      text: "It shows each change as a diff and applies the ones you confirm; `--yes` applies them all. [Install Lucent](/docs/install/) lists the changes for Expo and bare apps. Running it again changes nothing.",
    },
  ],
  doctor: [{ kind: "p", text: "Each check passes, warns or fails, with its fix. The exit code is 1 when one fails. It doesn't load the compiler, so it answers even when the project doesn't build." }],
  explain: [{ kind: "p", text: "Prints a code's entry from the [diagnostics](/docs/reference/diagnostics/): why the rule exists, the fix, and a wrong and a right example. `lucent explain 3006` works too." }],
  bench: [
    {
      kind: "code",
      filename: "src/path.bench.ts",
      code: `import { pathLength, spiralLength } from "./path.lucent";

const points = Array.from({ length: 1000 }, (_, i) => ({ x: Math.cos(i / 10) * i, y: Math.sin(i / 10) * i }));

export default {
  objects: () => pathLength(points),
  native: () => spiralLength(1000),
};`,
    },
    {
      kind: "p",
      text: "Each case runs as your module compiled to C++ and as the same TypeScript run as JavaScript, in a desktop Hermes. The results must match. It needs Hermes at `~/hermes`, or `HERMES_DIR`; [Design the boundary first](/docs/thinking/boundary-first/) shows its output.",
    },
  ],
};

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Every command finds the `*.lucent.ts` files under the project, skipping `node_modules`, `ios`, `android` and dot-directories, and the modules of the Lucent packages the app depends on. With no command, in a terminal, `lucent` opens `lucent dev` in a Lucent project and `lucent init` elsewhere.",
    },
    { kind: "table", head: ["Command", "What it does"], rows: cliCommands.map((c) => [`[\`lucent ${c.name}\`](#lucent-${c.name.replace(/ /g, "-")})`, c.summary]) },
    { kind: "h3", text: "Flags every command takes" },
    { kind: "table", head: ["Flag", "Meaning"], rows: globalFlags.map((f) => [`\`${f.flag}\``, f.description]) },
    { kind: "p", text: "Output is in color and animated only in a terminal. `NO_COLOR`, `FORCE_COLOR`, `CI` and `TERM=dumb` are respected. The tables on this page are generated from the command table `lucent --help` reads." },
    ...cliCommands.flatMap((c): Block[] => [
      { kind: "h2", text: `lucent ${c.name}` },
      { kind: "p", text: c.summary },
      ...(c.flags.length ? [{ kind: "table" as const, head: ["Flag", "Meaning"], rows: c.flags.map((f) => [`\`${f.flag}\``, f.description]) }] : []),
      ...(notes[c.name] ?? []),
    ]),
];

import { cliCommands, globalFlags } from "../../../generated/cli";
import type { Block, DocFrontmatter } from "../../types";

/** What the command table cannot say: examples and details, by command. */
const notes: Record<string, Block[]> = {
  build: [
    {
      kind: "code",
      filename: "terminal",
      copy: false,
      code: `◆ lucent {{lucent-version}}

✓ SDK bindings  CoreLocation · android.location · android.os  cached
✓ Checked 2 modules                     733 ms
✓ Generated C++  2 changed              24 ms
✓ Native package  .lucent/native

modules  location  ios android
         trip      shared
next     rebuild the app (iOS: pod install first)
actions  relink native dependencies  ios           LucentNative.podspec, cpp/generated/ios/m_location.mm +3 more
         recompile native code       ios, android  cpp/generated/ios/m_location.mm, cpp/generated/android/m_location.cpp +2 more`,
    },
    {
      kind: "list",
      items: [
        "When nothing changed since the last build, it says so and writes nothing, unless `--force`. Otherwise it rewrites only the files whose content changed.",
        "`next` says what the app needs: a rebuild (after `pod install` when files were added or removed), a reload, or nothing. `actions` lists each thing the changes need, on which platforms, and the generated files behind it.",
        "Actions come from what changed. A body edit recompiles native code, and new exports also reload JavaScript. A package's resources are repackaged, its libraries relinked. `Info.plist` entries, entitlements and manifest components need a reinstall. Other JavaScript needs nothing: Metro refreshes it.",
        "A platform whose SDK isn't installed is skipped, with a warning. `--platforms host` builds stubs whose platform code throws, for tests. `--platforms` takes `ios`, `android` and `host`, comma-separated; any other name exits with code 2.",
        "Android whose dependencies the Gradle build resolves (during `expo prebuild`) is left to that build. When it leaves no platform here, as on Linux without the iOS SDK, the build checks the shared code and writes the native package the Gradle build compiles.",
        "On a problem, nothing is written and the exit code is 1.",
      ],
    },
  ],
  check: [
    {
      kind: "p",
      text: "It reports problems as the [diagnostics](/docs/api/diagnostics/) page shows them, and writes nothing. A pass is remembered, so checking an unchanged project takes a fraction of a second. Use it in CI.",
    },
    {
      kind: "p",
      text: "On a machine without any platform SDK, such as a Linux CI runner, it checks as `--platforms host` does: the shared code and each module's declaration, with `lucent:ios/*` and `lucent:android/*` imports untyped, after a warning. Pass `--platforms host` to say so and skip the warning.",
    },
  ],
  dev: [
    {
      kind: "code",
      filename: "terminal",
      copy: false,
      code: `[14:02:11] ✓ 2 modules  36 ms · rebuild the app · recompile native code (ios, android)
[14:03:40] ✗ 1 error
  src/greet.lucent.ts:1:23  LUCENT2001  \`any\` has no native representation; give this value a concrete type
    fix: use a concrete type, a union, or a generic parameter`,
    },
    {
      kind: "p",
      text: "In a terminal, it shows a dashboard of modules, platforms and problems. Its keys rebuild (`r`), clear the cache (`c`), run the doctor (`d`), open a problem in your editor (`o`) and quit (`q`). With `--compact`, or outside a terminal, it prints one line per build, as above: that's what [`withLucent`](/docs/api/integrations/#metro) runs next to Metro.",
    },
    {
      kind: "p",
      text: "It watches the app and each Lucent package it links from outside it, such as a workspace package. It rebuilds when a file a build reads changes: a module, a `package.json` or `lucent.json`, or a native file a package lists. What builds write never triggers one, and a change during a build stops it before it writes anything.",
    },
  ],
  init: [
    {
      kind: "p",
      text: "It shows each change as a diff and applies the ones you confirm; `--yes` applies them all. [Install Lucent](/docs/guides/install/) lists the changes for Expo and bare apps. Running it again changes nothing.",
    },
  ],
  uninstall: [
    {
      kind: "p",
      text: "It reverts what `lucent init` and the Expo config plugin changed, shown as diffs like init's: it unwraps the Metro config, removes the plugin from `app.json`, the Gradle line, the `react-native.config.js` entry, the `lucent:*` path and the editor plugin from `tsconfig.json`, VS Code's TypeScript settings and the `.gitignore` lines. A file init created whole is deleted. The app's modules stay, and so does `noUncheckedIndexedAccess`. [Remove Lucent](/docs/guides/install/#remove-lucent) gives the steps after it.",
    },
  ],
  doctor: [
    {
      kind: "p",
      text: "Each check passes, warns or fails, with its fix. The exit code is 1 when one fails. It doesn't load the compiler, so it answers even when the project doesn't build.",
    },
    {
      kind: "p",
      text: "It also reads the app's builds, from the files they wrote, without building anything:",
    },
    {
      kind: "list",
      items: [
        "**Last build**: the steps the last `lucent build` failed at, such as an Android dependency conflict, with what each said and its log.",
        "**Build cache**: which steps ran again, and which input changed for each.",
        "**Native targets**: a platform the app has that this JavaScript was built without.",
        "**Native build**: whether the newest Xcode or Gradle build of the app has the APIs this JavaScript expects, checked as the app checks it. Other APIs fail, since the app would refuse the module; other sources with the same APIs warn.",
      ],
    },
  ],
  explain: [
    {
      kind: "p",
      text: "Prints a code's entry from the [diagnostics](/docs/api/diagnostics/): why the rule exists, the fix, and a wrong and a right example. `lucent explain 3006` works too.",
    },
  ],
  "sdk coverage": [
    {
      kind: "list",
      items: [
        "Without `--ios`, `--android` or `--all`, it reports the modules your code imports.",
        "With `--all`, a module the SDK lists but Lucent can't read, such as IOKit for the simulator, is warned about on stderr and skipped.",
        "`--summary` appends the members' totals and a table of the 20 most common reasons they're left out, then the modules that couldn't be read.",
      ],
    },
  ],
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
      text: "Each case runs as your module compiled to C++ and as the same TypeScript run as JavaScript, in a desktop Hermes. The results must match. It needs Hermes at `~/hermes`, or `HERMES_DIR`; [Compare a module's speed with JavaScript](/docs/guides/measure-performance/) shows its output.",
    },
  ],
};

export const frontmatter: DocFrontmatter = {
  title: "CLI",
  description: "Every `lucent` command and flag.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Every command finds the `*.lucent.ts` files under the project, skipping `node_modules`, `ios`, `android` and dot-directories, and the modules of the Lucent packages the app depends on. With no command, in a terminal, `lucent` opens `lucent dev` in a Lucent project and `lucent init` elsewhere.",
  },
  {
    kind: "table",
    head: ["Command", "What it does"],
    rows: cliCommands.map((c) => [
      `[\`lucent ${c.name}\`](#lucent-${c.name.replace(/ /g, "-")})`,
      c.summary,
    ]),
  },
  { kind: "h3", text: "Flags every command takes" },
  {
    kind: "table",
    head: ["Flag", "Meaning"],
    rows: globalFlags.map((f) => [`\`${f.flag}\``, f.description]),
  },
  {
    kind: "p",
    text: "Output is in color and animated only in a terminal. `NO_COLOR`, `FORCE_COLOR`, `CI` and `TERM=dumb` are respected. The tables on this page are generated from the command table `lucent --help` reads.",
  },
  ...cliCommands.flatMap((c): Block[] => [
    { kind: "h2", text: `lucent ${c.name}` },
    { kind: "p", text: c.summary },
    ...(c.flags.length
      ? [
          {
            kind: "table" as const,
            head: ["Flag", "Meaning"],
            rows: c.flags.map((f) => [`\`${f.flag}\``, f.description]),
          },
        ]
      : []),
    {
      kind: "p",
      text: c.json
        ? `With \`--json\`, it prints [one JSON document](/docs/api/json-formats/#lucent-${c.name.replace(/ /g, "-")}---json).`
        : "It has no JSON output: with `--json`, it exits with code 2.",
    },
    ...(notes[c.name] ?? []),
  ]),
];

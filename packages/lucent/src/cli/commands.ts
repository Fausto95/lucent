import type { CommandSpec } from "./args.ts";

/**
 * Every command: what the help, the parser and the docs read. A command's
 * code is imported only when it runs, so `lucent --help` stays fast.
 */
export const commands: CommandSpec[] = [
  {
    name: "build",
    json: "build",
    summary:
      "Compile the project's modules and write the native package (.lucent/native); skipped when nothing changed",
    flags: [
      { name: "force", description: "Rebuild even when nothing changed" },
      {
        name: "platforms",
        value: "list",
        description: "Targets for platform code: ios, android, host (default: the SDKs installed)",
      },
      {
        name: "out",
        value: "dir",
        description: "Where to write the native package (default: .lucent/native)",
      },
      {
        name: "frozen",
        description:
          "Fail unless the SDKs and SDK symbols are the ones lucent-sdk.lock.json records, with every target it lists (CI, releases)",
      },
    ],
    load: () => import("./commands/build.ts"),
  },
  {
    name: "check",
    json: "check",
    summary: "Type-check and validate every module without writing anything",
    flags: [
      {
        name: "frozen",
        description:
          "Fail unless the SDKs and SDK symbols are the ones lucent-sdk.lock.json records, with every target it lists (CI, releases)",
      },
    ],
    load: () => import("./commands/check.ts"),
  },
  {
    name: "dev",
    summary:
      "Rebuild on every change: a live dashboard of modules, platforms and problems (one line per build outside a terminal)",
    flags: [
      {
        name: "compact",
        description: "One line per build instead of the dashboard (Metro runs it so)",
      },
    ],
    load: () => import("./commands/dev.ts"),
  },
  {
    name: "doctor",
    json: "doctor",
    summary:
      "Check the machine, the app and its builds: Node, React Native, Xcode, CocoaPods, Android, the JDK, Metro, versions",
    flags: [],
    load: () => import("./commands/doctor.ts"),
  },
  {
    name: "init",
    summary:
      "Set an app up for Lucent: the Metro config, the Expo plugin or the Gradle task, tsconfig.json, .gitignore, a first module",
    flags: [{ name: "yes", description: "Apply every change without asking" }],
    load: () => import("./commands/init.ts"),
  },
  {
    name: "new module",
    json: "new",
    summary:
      "Scaffold a module in src/: shared, or with --ios / --android one module that branches on PLATFORM",
    flags: [
      {
        name: "ios",
        description: "Implement the iOS branch (without --android, the Android branch throws)",
      },
      {
        name: "android",
        description: "Implement the Android branch (without --ios, the iOS branch throws)",
      },
      { name: "shared", description: "One module for every platform (the default)" },
    ],
    load: () => import("./commands/new-module.ts"),
  },
  {
    name: "new view",
    json: "new",
    summary:
      "Scaffold a component in src/: its declaration, and each platform's native views in a Flex",
    flags: [],
    internal: true,
    load: () => import("./commands/new-view.ts"),
  },
  {
    name: "explain",
    json: "explain",
    summary: "What a LUCENT diagnostic code means, and how to fix it (every code without one)",
    flags: [],
    load: () => import("./commands/explain.ts"),
  },
  {
    name: "bench",
    json: true,
    summary:
      "Time the cases of your *.bench.ts files natively and as JavaScript, and show the speedup (needs a desktop Hermes)",
    flags: [],
    load: () => import("./commands/bench.ts"),
  },
  {
    name: "trace",
    summary:
      "Write the last build's steps and the runtime traces given as one Chrome trace (.lucent/trace.json), and how long each cause took",
    flags: [
      {
        name: "runtime",
        value: "files",
        description:
          "Runtime traces to include, comma-separated (written with LUCENT_TRACE=<file>.json)",
      },
      {
        name: "out",
        value: "file",
        description: "Where to write it (default: .lucent/trace.json)",
      },
    ],
    load: () => import("./commands/trace.ts"),
  },
  {
    name: "clean",
    json: "clean",
    summary: "Remove the generated .lucent/ (the next build starts over)",
    flags: [{ name: "cache", description: "Also remove the SDK bindings cache" }],
    load: () => import("./commands/clean.ts"),
  },
  {
    name: "sdk search",
    json: "sdk-search",
    summary:
      "Find SDK classes and members by name, with the import to copy (your imports and the SDK cache)",
    flags: [],
    load: () => import("./commands/sdk-search.ts"),
  },
  {
    name: "sdk show",
    json: "sdk-show",
    summary:
      "Print the declaration Lucent code sees for an SDK type or member: android.os.Vibrator, UIKit.UIDevice.current",
    flags: [],
    load: () => import("./commands/sdk-show.ts"),
  },
  {
    name: "sdk prefetch",
    json: "sdk-prefetch",
    summary:
      "Extract SDK bindings into the cache ahead of use (default: the lucent:* modules the project imports)",
    flags: [
      {
        name: "ios",
        value: "modules",
        optional: true,
        description: "iOS modules, comma-separated; alone: every module",
      },
      {
        name: "android",
        value: "packages",
        optional: true,
        description: "Android packages, comma-separated; alone: every package",
      },
      { name: "all", description: "Every module of every installed SDK" },
    ],
    load: () => import("./commands/sdk-prefetch.ts"),
  },
  {
    name: "sdk lock",
    json: "sdk-lock-result",
    summary:
      "Record the SDKs and SDK symbols the project uses in lucent-sdk.lock.json, for --frozen builds and sdk diff",
    flags: [
      {
        name: "platforms",
        value: "list",
        description:
          "Targets to record: ios, android (default: every platform the project has code for, each needing its SDK)",
      },
    ],
    load: () => import("./commands/sdk-lock.ts"),
  },
  {
    name: "sdk diff",
    json: "sdk-diff",
    summary:
      "What the installed SDKs change for the SDK symbols lucent-sdk.lock.json records: removed and changed members, before rebuilding",
    flags: [
      {
        name: "all",
        description:
          "Also the other members of the modules the project uses (the locked schemas must be in this machine's SDK cache)",
      },
    ],
    load: () => import("./commands/sdk-diff.ts"),
  },
  {
    name: "sdk coverage",
    json: "sdk-coverage",
    summary:
      "Per SDK module, how far members get: discovered, representable, generated by the last build, exercised",
    flags: [
      { name: "ios", value: "modules", description: "iOS modules, comma-separated" },
      {
        name: "android",
        value: "packages",
        description: "Android packages, comma-separated (p.* for a prefix)",
      },
      {
        name: "check",
        value: "baseline",
        description: "Fail when the unrepresentable share grows past a baseline JSON",
      },
      {
        name: "exercised",
        value: "file",
        description: "A JSON array of the symbol keys tests or probes ran (see --members)",
      },
      { name: "all", description: "Every module of each SDK there is" },
      {
        name: "summary",
        value: "file",
        description: "Append a markdown summary of why members are left out (CI's step summary)",
      },
      { name: "members", description: "List every member with its stage, key and reason" },
      {
        name: "views",
        description:
          "With views on (LUCENT_VIEWS=fabric), list each view class's JSX attributes by rule",
      },
    ],
    load: () => import("./commands/sdk-coverage.ts"),
  },
];

import type { CommandSpec } from "./args.ts";

/**
 * Every command: what the help, the parser and the docs read. A command's
 * code is imported only when it runs, so `lucent --help` stays fast.
 */
export const commands: CommandSpec[] = [
  {
    name: "build",
    summary: "Compile the project's modules and write the native package (.lucent/native); skipped when nothing changed",
    flags: [
      { name: "force", description: "Rebuild even when nothing changed" },
      { name: "platforms", value: "list", description: "Targets for platform code: ios, android, host (default: the SDKs installed)" },
      { name: "out", value: "dir", description: "Where to write the native package (default: .lucent/native)" },
    ],
    load: () => import("./commands/build.ts"),
  },
  {
    name: "check",
    summary: "Type-check and validate every module without writing anything",
    flags: [],
    load: () => import("./commands/check.ts"),
  },
  {
    name: "dev",
    summary: "Rebuild on every change: a live dashboard of modules, platforms and problems (one line per build outside a terminal)",
    flags: [{ name: "compact", description: "One line per build instead of the dashboard (Metro runs it so)" }],
    load: () => import("./commands/dev.ts"),
  },
  {
    name: "doctor",
    summary: "Check the machine and the app: Node, React Native, Xcode, CocoaPods, the Android SDK, the JDK, the Metro config, versions",
    flags: [],
    load: () => import("./commands/doctor.ts"),
  },
  {
    name: "init",
    summary: "Set an app up for Lucent: the Metro config, the Expo plugin or the Gradle task, tsconfig.json, .gitignore, a first module",
    flags: [{ name: "yes", description: "Apply every change without asking" }],
    load: () => import("./commands/init.ts"),
  },
  {
    name: "new module",
    summary: "Scaffold a module in src/: shared, or with --ios / --android one module that branches on PLATFORM",
    flags: [
      { name: "ios", description: "Implement the iOS branch (without --android, the Android branch throws)" },
      { name: "android", description: "Implement the Android branch (without --ios, the iOS branch throws)" },
      { name: "shared", description: "One module for every platform (the default)" },
    ],
    load: () => import("./commands/new-module.ts"),
  },
  {
    name: "explain",
    summary: "What a LUCENT diagnostic code means, and how to fix it (every code without one)",
    flags: [],
    load: () => import("./commands/explain.ts"),
  },
  {
    name: "bench",
    summary: "Time the cases of your *.bench.ts files natively and as JavaScript, and show the speedup (needs a desktop Hermes)",
    flags: [],
    load: () => import("./commands/bench.ts"),
  },
  {
    name: "clean",
    summary: "Remove the generated .lucent/ (the next build starts over)",
    flags: [{ name: "cache", description: "Also remove the SDK bindings cache" }],
    load: () => import("./commands/clean.ts"),
  },
  {
    name: "sdk search",
    summary: "Find SDK classes and members by name, with the import to copy (your imports and the SDK cache)",
    flags: [],
    load: () => import("./commands/sdk-search.ts"),
  },
  {
    name: "sdk show",
    summary: "Print the declaration Lucent code sees for an SDK type or member: android.os.Vibrator, UIKit.UIDevice.current",
    flags: [],
    load: () => import("./commands/sdk-show.ts"),
  },
  {
    name: "sdk prefetch",
    summary: "Extract SDK bindings into the cache ahead of use (default: the lucent:* modules the project imports)",
    flags: [
      { name: "ios", value: "modules", optional: true, description: "iOS modules, comma-separated; alone: every module" },
      { name: "android", value: "packages", optional: true, description: "Android packages, comma-separated; alone: every package" },
      { name: "all", description: "Every module of every installed SDK" },
    ],
    load: () => import("./commands/sdk-prefetch.ts"),
  },
  {
    name: "sdk coverage",
    summary: "Per SDK module, the members Lucent code can call: idiomatic, raw, unrepresentable",
    flags: [
      { name: "ios", value: "modules", description: "iOS modules, comma-separated" },
      { name: "android", value: "packages", description: "Android packages, comma-separated (p.* for a prefix)" },
      { name: "check", value: "baseline", description: "Fail when the unrepresentable share grows past a baseline JSON" },
    ],
    load: () => import("./commands/sdk-coverage.ts"),
  },
];

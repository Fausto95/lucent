import type { DocEntry, DocGroup } from "./types";

/**
 * Every docs page, in reading order: the sidebar, the routes and each page's
 * default "Next" link follow it.
 */
export const docsGroups: DocGroup[] = [
  {
    label: "Start",
    entries: [
      {
        slug: "",
        kind: "start",
        title: "What is Lucent",
        description: "Lucent compiles TypeScript modules to C++ for React Native: you write a `.lucent.ts` file, and your app calls it as native code.",
      },
      {
        slug: "install",
        kind: "start",
        title: "Install Lucent",
        description: "Add one dev dependency, run `lucent init` to set the app up, and check the machine with `lucent doctor`.",
      },
      {
        slug: "first-module",
        kind: "start",
        title: "Your first module",
        description: "In ten minutes: write a module, call it from a screen, change it, and read a compile error.",
      },
    ],
  },
  {
    label: "How Lucent works",
    entries: [
      {
        slug: "how-it-works",
        kind: "learn",
        title: "How a module becomes native code",
        description: "Five steps turn a `.lucent.ts` file into C++ in your app binary, and into a proxy in your JS bundle.",
      },
      {
        slug: "how-it-works/calls",
        kind: "learn",
        title: "How a call reaches native code",
        description: "A call goes from your JavaScript through a proxy and JSI to your C++. Synchronous calls stay on the JS thread; async ones run on the Lucent thread.",
      },
      {
        slug: "how-it-works/platform-calls",
        kind: "learn",
        title: "How an SDK call reaches iOS and Android",
        description: "An SDK call compiles to an Objective-C message send on iOS and a JNI call on Android, typed from the SDKs on your machine.",
      },
    ],
  },
  {
    label: "Legacy",
    entries: [
      { slug: "comparison", kind: "other", legacy: true, title: "Comparison", description: "How Lucent compares with Expo Modules, Nitro Modules and Turbo Native Modules, and when to pick each." },
      { slug: "status", kind: "other", legacy: true, title: "Status & roadmap", description: "What Lucent can do today, what it cannot do yet, and the milestones in between." },
      { slug: "language", kind: "learn", legacy: true, title: "Language overview", description: "Lucent modules are ordinary TypeScript files, restricted to a subset that has a native representation and compiled to C++." },
      { slug: "language/types", kind: "learn", legacy: true, title: "Types & values", description: "Every TypeScript type in a Lucent module maps to one native representation that behaves like the JavaScript value." },
      { slug: "language/functions", kind: "learn", legacy: true, title: "Functions & closures", description: "Lucent supports the statements, expressions and function forms of everyday TypeScript, with closures, generators, regular expressions and typed JSON parsing." },
      { slug: "language/classes", kind: "learn", legacy: true, title: "Classes", description: "Lucent classes compile to native objects with fields, methods, accessors, statics, inheritance and interfaces, and behave like JavaScript classes." },
      { slug: "language/generics", kind: "learn", legacy: true, title: "Generics", description: "Generic functions, classes and interfaces compile to C++ templates, instantiated for each concrete type they are used with." },
      { slug: "language/async", kind: "learn", legacy: true, title: "Async & concurrency", description: "Async functions compile to C++20 coroutines that interleave like JavaScript's, and exported async functions run off the JS thread." },
      { slug: "language/errors", kind: "learn", legacy: true, title: "Errors", description: "Lucent throws and catches Error values as JavaScript does, and can attach a machine-readable code to them." },
      { slug: "language/modules", kind: "learn", legacy: true, title: "Modules & imports", description: "Each `*.lucent.ts` file is a module of declarations that can import other Lucent modules and `lucent:core`, and exports what JavaScript may call." },
      { slug: "language/differences", kind: "learn", legacy: true, title: "Differences from JavaScript", description: "The complete list of places where a Lucent module behaves differently from the same code in JavaScript, and why." },
      { slug: "language/diagnostics", kind: "reference", legacy: true, title: "Diagnostics", description: "Every `LUCENT` code the compiler reports, what it means, and how to fix it." },
      { slug: "boundary/exports", kind: "learn", legacy: true, title: "Exports & proxies", description: "What a Lucent module shows to JavaScript, and how Metro swaps the import for a proxy to the native module." },
      { slug: "boundary/conversions", kind: "reference", legacy: true, title: "Type conversions", description: "How each TypeScript type crosses between JavaScript and native code, and what happens when a caller passes the wrong thing." },
      { slug: "boundary/callbacks", kind: "learn", legacy: true, title: "Callbacks", description: "Passing JavaScript functions and abort signals to Lucent, and which thread they run on." },
      { slug: "boundary/identity", kind: "learn", legacy: true, title: "Object identity", description: "Class instances cross the boundary by reference: they keep their identity and live as long as either side holds them." },
      { slug: "boundary/errors", kind: "learn", legacy: true, title: "Errors across the boundary", description: "How Lucent errors reach JavaScript, how JavaScript exceptions reach Lucent, and how native crashes map back to your source." },
      { slug: "reference/cli", kind: "reference", legacy: true, title: "CLI", description: "The `lucent` command from @lucent-lang/lucent: every subcommand and flag." },
      { slug: "reference/metro", kind: "reference", legacy: true, title: "Metro", description: "`withLucent` from @lucent-lang/lucent/metro: bundles each `*.lucent.ts` import as its native proxy and rebuilds while the dev server runs." },
      { slug: "reference/expo", kind: "reference", legacy: true, title: "Expo plugin", description: "The config plugin of @lucent-lang/lucent compiles your Lucent modules during `expo prebuild` and links the native package." },
      { slug: "reference/core", kind: "reference", legacy: true, title: "lucent:core", description: "The helpers Lucent modules can import, and the editor plugin that shows Lucent diagnostics as you type." },
      { slug: "platform-apis", kind: "guide", legacy: true, title: "Platform APIs", description: "Calling iOS and Android SDK APIs from Lucent through platform modules: an early, experimental milestone (M2.0).", next: "" },
    ],
  },
];

const flat = docsGroups.flatMap((group) => group.entries.map((entry) => ({ entry, group })));

export const docsEntries: DocEntry[] = flat.map(({ entry }) => entry);

export interface DocLookup {
  entry: DocEntry;
  group: DocGroup;
  /** The page the "Next" link points to. */
  next?: DocEntry;
}

export function findDoc(slug: string): DocLookup | undefined {
  const index = flat.findIndex(({ entry }) => entry.slug === slug);
  if (index === -1) return undefined;
  const { entry, group } = flat[index]!;
  const next = entry.next === undefined ? flat[index + 1]?.entry : flat.find((f) => f.entry.slug === entry.next)?.entry;
  return { entry, group, ...(next ? { next } : {}) };
}

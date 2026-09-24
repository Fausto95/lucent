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
    label: "Tutorial: a trip tracker",
    entries: [
      {
        slug: "tutorial/1-shared-logic",
        kind: "learn",
        title: "1. Measure a trip in shared code",
        description: "A module that measures distance and speed between GPS fixes, called from a screen.",
        samplesWith: "apps/tutorial/steps/1-shared-logic",
      },
      {
        slug: "tutorial/2-data",
        kind: "learn",
        title: "2. Keep the trip in native code",
        description: "A `Trip` class that holds its fixes natively, and a summary returned as a copied object.",
        samplesWith: "apps/tutorial/steps/2-data",
      },
      {
        slug: "tutorial/3-async",
        kind: "learn",
        title: "3. Simplify the route off the JS thread",
        description: "An `async` method that runs on the Lucent thread, and stops when JavaScript aborts it.",
        samplesWith: "apps/tutorial/steps/3-async",
      },
      {
        slug: "tutorial/4-errors",
        kind: "learn",
        title: "4. Throw errors JavaScript can handle",
        description: "Errors with codes, thrown in Lucent and caught by code in JavaScript.",
        samplesWith: "apps/tutorial/steps/4-errors",
      },
      {
        slug: "tutorial/5-platform-code",
        kind: "learn",
        title: "5. Read the position from iOS and Android",
        description: "One module that calls CoreLocation on iOS and `LocationManager` on Android.",
        samplesWith: "apps/tutorial/steps/5-platform-code",
      },
      {
        slug: "tutorial/6-callbacks",
        kind: "learn",
        title: "6. Send live positions to JavaScript",
        description: "A CoreLocation delegate and an Android listener that call a JS function with each new position.",
        samplesWith: "apps/tutorial/steps/6-callbacks",
      },
      {
        slug: "tutorial/7-permissions",
        kind: "learn",
        title: "7. Ask for the location permission",
        description: "The permission prompt, the `Info.plist` entry, and Android permissions added for you.",
        samplesWith: "apps/tutorial/steps/7-permissions",
      },
      {
        slug: "tutorial/8-publish",
        kind: "learn",
        title: "8. Publish the module as a package",
        description: "The trip tracker as an npm package that apps install and compile with their own modules.",
        samplesWith: "apps/tutorial/steps/8-publish",
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
    label: "Thinking in Lucent",
    entries: [
      {
        slug: "thinking/three-places",
        kind: "learn",
        title: "Three places your code runs",
        description: "Your code runs in the JS app, crosses the boundary, and runs natively. Values are copied across; class instances, functions and promises keep what they are.",
      },
      {
        slug: "thinking/boundary-first",
        kind: "learn",
        title: "Design the boundary first",
        description: "Decide what JavaScript calls before writing the module: plain data, few calls over data that stays native, `async` for slow work, errors with codes.",
      },
      {
        slug: "thinking/shared-first",
        kind: "learn",
        title: "Write shared code first, platform code last",
        description: "Keep logic in shared code and SDK calls in small platform branches of the same module. Split into platform files only when the halves share nothing.",
      },
      {
        slug: "thinking/threads",
        kind: "learn",
        title: "Which thread your code runs on",
        description: "Sync exports run on the JS thread, async ones on the Lucent thread, and `main()` on the main thread. One lock keeps Lucent code from racing itself.",
      },
      {
        slug: "thinking/memory",
        kind: "learn",
        title: "When memory is freed",
        description: "Objects are freed when their last reference goes. Break cycles, remove delegates and listeners, and close sessions yourself.",
      },
      {
        slug: "thinking/typescript",
        kind: "learn",
        title: "What changes from JavaScript",
        description: "Lucent is TypeScript whose every value has a native type: no `any`, no dynamic property access, no `eval`, and JavaScript's exact number semantics.",
      },
      {
        slug: "coming-from-native",
        kind: "learn",
        title: "Coming from Swift or Kotlin",
        description: "Swift and Kotlin concepts map to Lucent one to one. A module written in Swift, Kotlin and a JS binding becomes one Lucent module.",
      },
    ],
  },
  {
    label: "Guides",
    entries: [
      {
        slug: "guides/call-an-ios-api",
        kind: "guide",
        title: "Call an iOS API",
        description: "Import a framework from `lucent:ios/*` and call it with Swift's names, inside `main()` when it's main-thread only.",
      },
      {
        slug: "guides/call-an-android-api",
        kind: "guide",
        title: "Call an Android API",
        description: "Import a package from `lucent:android/*` and call it with Java's names, from the app's `Context`.",
      },
      {
        slug: "guides/find-an-sdk-class",
        kind: "guide",
        title: "Find an SDK class",
        description: "`lucent sdk search` finds classes and members with the import to copy; `lucent sdk show` prints what Lucent code sees.",
      },
      {
        slug: "guides/implement-a-delegate",
        kind: "guide",
        title: "Implement a delegate or listener",
        description: "A class that `implements` the SDK's protocol or interface, kept alive while the SDK calls it.",
      },
      {
        slug: "guides/send-events-to-javascript",
        kind: "guide",
        title: "Send events to JavaScript",
        description: "Take a JS callback, call it from async code, and return an id that stops it.",
      },
      {
        slug: "guides/accept-a-js-callback",
        kind: "guide",
        title: "Accept a JS callback",
        description: "A function parameter: called at once during a synchronous call, posted to the JS thread from async code.",
      },
      {
        slug: "guides/run-work-off-the-js-thread",
        kind: "guide",
        title: "Run work off the JS thread",
        description: "Make the export `async`: it runs on the Lucent thread, and its result resolves a promise in JavaScript.",
      },
      {
        slug: "guides/cancel-work",
        kind: "guide",
        title: "Cancel work",
        description: "Take an `AbortSignal` from JavaScript and check it; the promise rejects with an `AbortError`.",
      },
      {
        slug: "guides/run-on-the-main-thread",
        kind: "guide",
        title: "Run code on the main thread",
        description: "`main(() => …)` from `lucent:thread` runs a function on the main thread and resolves with its result.",
      },
      {
        slug: "guides/throw-and-handle-errors",
        kind: "guide",
        title: "Throw and handle errors",
        description: "`error(code, message)` throws an error JavaScript receives with its `code`. Errors from JavaScript and the SDK arrive the same way.",
      },
      {
        slug: "guides/check-the-os-version",
        kind: "guide",
        title: "Check the OS version",
        description: "`available(\"ios\", 17)` and `available(\"android\", 31)` guard newer APIs. On Android, the compiler requires it.",
      },
      {
        slug: "guides/share-code-between-platforms",
        kind: "guide",
        title: "Share code between iOS and Android",
        description: "One module with a platform branch per SDK call; platform files only when the halves share nothing.",
      },
      {
        slug: "guides/add-permissions-and-config",
        kind: "guide",
        title: "Add permissions and native config",
        description: "Android permissions come from the SDK; iOS usage descriptions go in `Info.plist` or `app.json`.",
      },
      {
        slug: "guides/use-a-third-party-sdk",
        kind: "guide",
        title: "Use a third-party SDK",
        description: "Add the pod or Gradle dependency to the app as usual, then import it from `lucent:ios/*` or `lucent:android/*`.",
      },
      {
        slug: "guides/publish-a-library",
        kind: "guide",
        title: "Publish a Lucent library",
        description: "An npm package with a `lucent` field in `package.json`, its modules as source, and a `lucent.json` for its native needs.",
      },
      {
        slug: "guides/use-a-library",
        kind: "guide",
        title: "Use a Lucent library",
        description: "Install it with npm: `lucent build` compiles its modules with the app's, with their pods, dependencies and permissions.",
      },
      {
        slug: "guides/port-an-expo-module",
        kind: "guide",
        title: "Port an Expo Module",
        description: "Keep the TypeScript API, and write the Swift and Kotlin bodies as the two branches of one Lucent module.",
      },
      {
        slug: "guides/port-a-turbomodule",
        kind: "guide",
        title: "Port a TurboModule or Nitro module",
        description: "The spec becomes the module's exports, hybrid objects become classes, and codegen goes away.",
      },
      {
        slug: "guides/test-a-module",
        kind: "guide",
        title: "Test a module",
        description: "`lucent bench` compares native and JavaScript results. A host build runs shared code on your computer, and devices check the SDK calls.",
      },
      {
        slug: "guides/debug-a-crash",
        kind: "guide",
        title: "Debug a crash",
        description: "Errors carry their `.lucent.ts` line to JavaScript, logs go to the unified log and logcat, and native crashes point at your source.",
      },
      {
        slug: "guides/measure-performance",
        kind: "guide",
        title: "Measure performance",
        description: "`lucent bench` times each case natively and as JavaScript, and shows the speedup.",
      },
      {
        slug: "guides/upgrade",
        kind: "guide",
        title: "Upgrade Xcode, the Android SDK or Lucent",
        description: "A new SDK is read again on the next build. A new Lucent needs `lucent doctor`, a build, and an app rebuild.",
      },
    ],
  },
  {
    label: "Reference",
    entries: [
      {
        slug: "reference/language",
        kind: "reference",
        title: "Language features",
        description: "Every TypeScript feature: whether Lucent supports it, and what to write instead when it doesn't.",
      },
      {
        slug: "reference/built-ins",
        kind: "reference",
        title: "Built-ins",
        description: "The JavaScript built-ins Lucent has, and where they differ from JavaScript's.",
      },
      {
        slug: "reference/boundary-types",
        kind: "reference",
        title: "Types across the boundary",
        description: "How each type crosses between JavaScript and Lucent: its C++ form, copy or reference, and what JavaScript must pass.",
      },
      {
        slug: "reference/platform-types",
        kind: "reference",
        title: "SDK types",
        description: "How iOS and Android SDK declarations appear in Lucent: names, nullability, enums, errors, callbacks.",
      },
      {
        slug: "reference/modules",
        kind: "reference",
        title: "The lucent:* modules",
        description: "The declarations of `lucent:core`, `lucent:platform`, `lucent:thread`, `lucent:ios` and `lucent:android`.",
      },
      {
        slug: "reference/cli",
        kind: "reference",
        title: "CLI",
        description: "Every `lucent` command and flag.",
      },
      {
        slug: "reference/lucent-json",
        kind: "reference",
        title: "lucent.json",
        description: "What a Lucent package's platform code needs from the app: pods, Gradle dependencies, permissions, `Info.plist` entries.",
      },
      {
        slug: "reference/metro-and-expo",
        kind: "reference",
        title: "Metro, Expo and editor options",
        description: "The options of `withLucent`, the Expo config plugin and the editor plugin.",
      },
      {
        slug: "reference/diagnostics",
        kind: "reference",
        title: "Diagnostics",
        description: "Every `LUCENT` code, with its reason, its fix, and a wrong and a right example.",
      },
      {
        slug: "reference/compatibility",
        kind: "reference",
        title: "Compatibility",
        description: "The React Native, Expo, Node, JDK, Android and iOS versions Lucent supports.",
      },
    ],
  },
  {
    label: "Examples",
    entries: [
      {
        slug: "examples",
        kind: "other",
        title: "Examples that call iOS and Android",
        description: "Ports of popular Expo and community modules, each one Lucent module for both platforms, running in the repository's example apps.",
      },
      {
        slug: "examples/clipboard",
        kind: "example",
        title: "Clipboard",
        description: "`expo-clipboard`'s text API on `UIPasteboard` and Android's `ClipboardManager`.",
      },
      {
        slug: "examples/location",
        kind: "example",
        title: "Location",
        description: "`expo-location`'s API on CoreLocation and Android's `LocationManager`: permission, current position, and positions sent to JavaScript as they arrive.",
      },
      {
        slug: "examples/netinfo",
        kind: "example",
        title: "Network state",
        description: "`@react-native-community/netinfo`'s API on the Network framework and Android's `ConnectivityManager`, with change events sent to JavaScript.",
      },
      {
        slug: "examples/local-authentication",
        kind: "example",
        title: "Local authentication",
        description: "`expo-local-authentication`'s API on `LAContext` and Android's `BiometricManager`: hardware, enrollment and a Face ID or Touch ID prompt.",
      },
      {
        slug: "examples/secure-store",
        kind: "example",
        title: "Secure store",
        description: "`expo-secure-store`'s API on the iOS Keychain and the Android Keystore, shipped as a Lucent package.",
      },
      {
        slug: "examples/haptics",
        kind: "example",
        title: "Haptics",
        description: "`expo-haptics`' API on UIKit's feedback generators and Android's `Vibrator`, shipped as a Lucent package.",
      },
    ],
  },
  {
    label: "Legacy",
    entries: [
      { slug: "comparison", kind: "other", legacy: true, title: "Comparison", description: "How Lucent compares with Expo Modules, Nitro Modules and Turbo Native Modules, and when to pick each." },
      { slug: "status", kind: "other", legacy: true, title: "Status & roadmap", description: "What Lucent can do today, what it cannot do yet, and the milestones in between.", next: "" },
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

import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "platform-apis",
  title: "Platform APIs",
  description: "Calling iOS and Android SDK APIs from Lucent through platform modules: an early, experimental milestone (M2.0).",
  blocks: [
    {
      kind: "note",
      tone: "warn",
      text: "**Experimental.** Platform APIs are the first step of milestone M2 and will change. What works today: platform modules, the whole public Android SDK (generated from `android.jar`), and a hand-written subset of UIKit on iOS. Delegates, listeners and completion handlers do not work yet. Plan for gaps, and check the [roadmap](https://github.com/Fausto95/lucent/blob/cpp-jsi/ROADMAP.md).",
    },
    {
      kind: "p",
      text: "Lucent modules can call the platform SDK directly: Objective-C message sends on iOS and JNI calls on Android, generated from your TypeScript. There is no Swift or Kotlin wrapper to write, and JavaScript sees one API for both platforms.",
    },
    { kind: "h2", text: "Platform modules" },
    {
      kind: "p",
      text: "A platform module is three files. The shared file declares the API; each platform file implements it and may import that platform's SDK.",
    },
    {
      kind: "table",
      head: ["File", "Contains", "May import"],
      rows: [
        ["`haptics.lucent.ts`", "Only `export declare function`s, types and imports", "Other Lucent modules, `@lucent-lang/core`"],
        ["`haptics.ios.lucent.ts`", "The iOS implementation of every declared export", "Also `lucent:ios/<Framework>`, `lucent:ios`, `lucent:thread`"],
        ["`haptics.android.lucent.ts`", "The Android implementation of every declared export", "Also `lucent:android/<package>`, `lucent:android`, `lucent:thread`"],
      ],
    },
    {
      kind: "tabs",
      tabs: [
        {
          label: "Shared",
          filename: "haptics.lucent.ts",
          code: `export type Impact = "light" | "medium" | "heavy";

/** Plays a tap on the device's haptic engine. */
export declare function impact(style: Impact): Promise<void>;

/** The device model and OS version, from the SDK. */
export declare function deviceName(): Promise<string>;`,
        },
        {
          label: "iOS",
          filename: "haptics.ios.lucent.ts",
          code: `import {
  UIDevice,
  UIImpactFeedbackGenerator,
  UIImpactFeedbackGenerator_FeedbackStyle as FeedbackStyle,
} from "lucent:ios/UIKit";
import { main } from "lucent:thread";
type Impact = "light" | "medium" | "heavy";

function feedbackStyle(style: Impact): FeedbackStyle {
  switch (style) {
    case "light":
      return FeedbackStyle.light;
    case "medium":
      return FeedbackStyle.medium;
    case "heavy":
      return FeedbackStyle.heavy;
  }
}

// UIKit is main-thread only: main() runs the closure on the main thread.
export function impact(style: Impact): Promise<void> {
  return main(() => {
    const generator = new UIImpactFeedbackGenerator(feedbackStyle(style));
    generator.prepare();
    generator.impactOccurred();
  });
}

export function deviceName(): Promise<string> {
  return main(() => \`\${UIDevice.current.model} (\${UIDevice.current.systemName} \${UIDevice.current.systemVersion})\`);
}`,
        },
        {
          label: "Android",
          filename: "haptics.android.lucent.ts",
          code: `import { Build, Build_VERSION, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
import { error } from "@lucent-lang/core";
type Impact = "light" | "medium" | "heavy";

function vibrator(): Vibrator {
  const context = appContext();
  const v = available("android", 31)
    ? context.getSystemService(VibratorManager)?.defaultVibrator
    : context.getSystemService(Vibrator);
  if (!v) throw error("E_NO_VIBRATOR", "This device has no vibrator");
  return v;
}

export async function impact(style: Impact): Promise<void> {
  const ms = style === "light" ? 20 : style === "medium" ? 40 : 60;
  if (available("android", 26)) {
    vibrator().vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
  } else {
    vibrator().vibrate(ms);
  }
}

export async function deviceName(): Promise<string> {
  return \`\${Build.MODEL ?? "Android device"} (Android \${Build_VERSION.RELEASE ?? "?"})\`;
}`,
        },
      ],
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { impact, deviceName } from "./haptics.lucent";

await impact("medium");
await deviceName(); // "iPhone (iOS 27.0)" or "Pixel 9 (Android 16)"`,
    },
    {
      kind: "list",
      items: [
        "Each implementation must export exactly the declared functions, with compatible types (`LUCENT3005`). Shared code and enums go in another module that all three import.",
        "Each platform is type-checked on its own: `lucent:ios/*` resolves only in `.ios.lucent.ts` files and `lucent:android/*` only in `.android.lucent.ts` files (`LUCENT3004`).",
        "Other Lucent modules import the shared file (`./haptics.lucent`) and get the platform's implementation.",
        "`lucent build --platforms host` builds stubs that throw `haptics.impact is not available on this platform`, so the rest of the app can run in tests (see [CLI](/docs/reference/cli/)).",
      ],
    },
    { kind: "h2", text: "What is bound today" },
    {
      kind: "table",
      head: ["Platform", "Import", "Coverage"],
      rows: [
        [
          "Android",
          "`lucent:android/<package>`, for example `lucent:android/android.os` or `lucent:android/java.util`",
          "Every package of `android.jar` (API level 37), generated from its class files: classes, constructors, methods, fields and constants, with nullability from annotations and API levels. About 1% of members are skipped, mostly those typed with class type variables (such as collection elements).",
        ],
        [
          "iOS",
          "`lucent:ios/UIKit`",
          "Hand-written: `UIImpactFeedbackGenerator`, `UINotificationFeedbackGenerator`, `UISelectionFeedbackGenerator` and `UIDevice`. Nothing else yet.",
        ],
      ],
    },
    {
      kind: "p",
      text: "SDK names are kept: Swift names on iOS (`UIDevice.current`, nested types joined with `_` as in `UIImpactFeedbackGenerator_FeedbackStyle`), Java names on Android plus Kotlin-style properties for getters (`VibratorManager.defaultVibrator`). Nullable SDK values are `T | null`; unannotated Java references are nullable (`Build.MODEL: string | null`). A `Class<T>` parameter takes the class itself: `context.getSystemService(Vibrator)` returns `Vibrator | null`.",
    },
    { kind: "h2", text: "Helpers" },
    {
      kind: "table",
      head: ["Import", "From", "Does"],
      rows: [
        [
          "`main(f)`",
          "`lucent:thread`",
          "Runs `f` on the main thread and resolves with its result; the caller does not block. Main-thread-only APIs (the UIKit classes above) are a compile error outside `main(() => …)` (`LUCENT3006`).",
        ],
        ["`available(\"ios\", major, minor?)`", "`lucent:ios`", "Whether the running iOS version is at least `major.minor`."],
        ["`available(\"android\", api)`", "`lucent:android`", "Whether the running Android API level is at least `api`."],
        ["`appContext()`", "`lucent:android`", "The Android `Application` context."],
      ],
    },
    { kind: "h2", text: "Rules at the boundary" },
    {
      kind: "list",
      items: [
        "Platform objects (`UIDevice`, `Vibrator`, …) stay native: they cannot be passed to or returned to JavaScript (`LUCENT2006`). Convert to plain data first.",
        "`===` on platform objects compares identity.",
        "A Java exception becomes a Lucent error whose `code` is the exception class (`java.lang.IllegalArgumentException`) and whose message is the exception's. A `nil` or `null` where the SDK promises an object throws `TypeError`.",
        "The compiler does not yet check that APIs newer than your minimum OS version are guarded by `available()`; guard them yourself.",
      ],
    },
    { kind: "h2", text: "Planned" },
    {
      kind: "p",
      text: "The following are designed but **not implemented**. This code does not compile today:",
    },
    {
      kind: "code",
      filename: "location.ios.lucent.ts (planned)",
      code: `import { CLLocationManager } from "lucent:ios/CoreLocation";`,
    },
    {
      kind: "list",
      items: [
        "iOS bindings generated from the SDK's headers, so any framework can be imported, as Android already is.",
        "Delegates and listeners: implementing an SDK protocol or Java interface in Lucent.",
        "Completion handlers as promises, availability narrowing after `available()`, and editor support for `lucent:*` imports.",
        "Third-party native libraries (CocoaPods, Gradle dependencies) and declared permissions.",
        "Native views are milestone M3.",
      ],
    },
    {
      kind: "p",
      text: "Progress is tracked in the [roadmap](https://github.com/Fausto95/lucent/blob/cpp-jsi/ROADMAP.md).",
    },
  ],
};

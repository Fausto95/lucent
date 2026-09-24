import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "list",
    ordered: true,
    items: [
      "Copy the module's TypeScript API: its exported functions, types and enums. That's your module's export list.",
      'For each function, take the Swift and the Kotlin body and write them as the two branches of one Lucent function, `if (PLATFORM === "ios") { … } else { … }`.',
      "Keep the SDK calls; change the syntax. Swift's names work as they are, nested types join with `_`, and Kotlin's getters are properties.",
      "Replace `AsyncFunction(…).runOnQueue(.main)` with an `async` function whose SDK calls sit in `main()`.",
      'Replace `throw Exception(…)` with `throw error("ERR_CODE", message)`, keeping the original\'s codes, so JavaScript can test them.',
      "Replace events (`sendEvent`) with a callback parameter and a stop function. See [Send events to JavaScript](/docs/guides/send-events-to-javascript/).",
      "Delete the Swift, the Kotlin, the podspec, the Gradle file and `expo-module.config.json`. Point the JavaScript imports at the `.lucent` module.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      {
        label: "Expo Module (Swift)",
        filename: "ClipboardModule.swift",
        code: `AsyncFunction("hasStringAsync") { () -> Bool in
  UIPasteboard.general.hasStrings
}`,
      },
      {
        label: "Lucent",
        filename: "clipboard.lucent.ts",
        code: `import { PLATFORM } from "lucent:platform";
import { UIPasteboard } from "lucent:ios/UIKit";
import { ClipboardManager, ClipDescription } from "lucent:android/android.content";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

export async function hasStringAsync(): Promise<boolean> {
  if (PLATFORM === "ios") {
    return UIPasteboard.general.hasStrings;
  } else {
    return main(() => {
      const manager = appContext().getSystemService(ClipboardManager);
      return manager?.getPrimaryClipDescription()?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ?? false;
    });
  }
}`,
      },
    ],
  },
  {
    kind: "p",
    text: "Test the port next to the original: call both from one screen and compare. The [examples](/docs/examples/) are ports of six Expo and community modules, each checked this way.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "Some SDK features aren't bound yet, such as Android generics and iOS subclassing. [SDK types](/docs/reference/platform-types/#not-bound-yet) lists them; check before you start.",
  },
];

import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "battery.lucent.ts",
    cpp: true,
    code: `import { PLATFORM } from "lucent:platform";
import { BatteryManager } from "lucent:android/android.os";
import { appContext } from "lucent:android";
import { error } from "lucent:core";

export async function isCharging(): Promise<boolean> {
  if (PLATFORM === "android") {
    const manager = appContext().getSystemService(BatteryManager);
    if (!manager) throw error("E_NO_BATTERY", "BatteryManager isn't available");
    return manager.charging;
  } else {
    throw error("E_UNSUPPORTED", "Only Android is implemented");
  }
}`,
  },
  {
    kind: "list",
    items: [
      "Import from `lucent:android/<package>`: any package of `android.jar`, or of the app's Gradle dependencies.",
      "`appContext()` from `lucent:android` is the app's `Context`.",
      "A `Class<T>` parameter takes the class itself: `getSystemService(BatteryManager)` returns a `BatteryManager | null`.",
      "`isCharging()` is also the property `charging`, as Kotlin makes properties of getters.",
      "References the SDK doesn't mark `@NonNull` are `T | null`, so check them.",
    ],
  },
  {
    kind: "p",
    text: "A Java exception becomes a thrown error whose `code` is the exception's class. Nested classes join with `_`: `Build.VERSION` is `Build_VERSION`. [SDK types](/docs/reference/platform-types/#android) has every rule.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "APIs newer than API 24 compile only behind a version check. See [Check the OS version](/docs/guides/check-the-os-version/).",
  },
];

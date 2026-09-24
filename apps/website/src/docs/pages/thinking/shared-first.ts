import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "battery.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { BatteryManager } from "lucent:android/android.os";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

// Shared: plain Lucent, the same on both platforms.
export function describe(level: number): string {
  if (level < 0) return "unknown";
  return level < 0.2 ? "low" : "ok";
}

// Platform code: only the SDK call differs.
export async function level(): Promise<number> {
  if (PLATFORM === "ios") {
    return main(() => {
      UIDevice.current.isBatteryMonitoringEnabled = true;
      return UIDevice.current.batteryLevel;
    });
  } else {
    const manager = appContext().getSystemService(BatteryManager);
    const percent = manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?? -1;
    return percent < 0 ? -1 : percent / 100;
  }
}`,
  },
  {
    kind: "p",
    text: "Put as much as possible in shared code: it is one piece of logic, tested once. Keep platform code to the SDK calls, and turn their results into plain values as soon as you can.",
  },
  { kind: "h2", text: "Where each piece goes" },
  {
    kind: "list",
    items: [
      "**No SDK call**: shared code, in any module. It also runs in tests on your computer.",
      "**A few SDK calls in a function**: a platform branch, `if (PLATFORM === \"ios\") { … } else { … }`, in the same module.",
      "**Helpers, delegates or state that use one SDK**: top-level declarations of the same module. They belong to that platform, and compile only there.",
      "**Two halves that share nothing**: platform files, `x.ios.lucent.ts` and `x.android.lucent.ts`, behind a declaration file `x.lucent.ts`. This is the rare case.",
    ],
  },
  {
    kind: "note",
    tone: "warn",
    text: "A branch needs its `else`. After `if (PLATFORM === \"ios\") return …;`, the following code is still shared, so an Android call there fails with `LUCENT3004`.",
  },
  {
    kind: "p",
    text: "Both branches are type-checked on every build. A platform whose SDK isn't installed is untyped, and its code is skipped.",
  },
];

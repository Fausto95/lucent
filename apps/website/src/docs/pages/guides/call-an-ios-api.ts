import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "battery.lucent.ts",
    cpp: true,
    code: `import { PLATFORM } from "lucent:platform";
import { UIDevice, UIDevice_BatteryState } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
import { error } from "lucent:core";

export async function isCharging(): Promise<boolean> {
  if (PLATFORM === "ios") {
    return main(() => {
      UIDevice.current.isBatteryMonitoringEnabled = true;
      const state = UIDevice.current.batteryState;
      return state === UIDevice_BatteryState.charging || state === UIDevice_BatteryState.full;
    });
  } else {
    throw error("E_UNSUPPORTED", "Only iOS is implemented");
  }
}`,
  },
  {
    kind: "list",
    items: [
      "Import from `lucent:ios/<Framework>`: any framework of your Xcode's SDK, or of the app's pods.",
      "Names are Swift's. A nested type joins its parts with `_`: Swift's `UIDevice.BatteryState` is `UIDevice_BatteryState`.",
      "UIKit is main-thread only, so the calls sit inside `main()`. Anywhere else they fail to compile with `LUCENT3006`.",
      "Return plain values: SDK objects can't cross to JavaScript.",
    ],
  },
  {
    kind: "p",
    text: "A method with a completion handler is also a promise, under the name Swift gives its `async` form. An `NSError` becomes a thrown error. [SDK types](/docs/reference/platform-types/#ios) has every rule.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "The first import of a large framework reads it from Xcode, which takes up to a minute once. `lucent sdk prefetch` does it ahead of time.",
  },
];

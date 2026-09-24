import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "code", filename: "terminal", code: "npx lucent sdk search BatteryManager" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `android  android.os
  class  BatteryManager  import { BatteryManager } from "lucent:android/android.os";

searched 297 modules of 299 (your imports and the SDK cache; lucent sdk prefetch --all to search every module)`,
  },
  {
    kind: "p",
    text: "The search matches classes and members, in the modules you import and those already cached. The import line is ready to copy. To search everything, run `lucent sdk prefetch --all` once.",
  },
  { kind: "code", filename: "terminal", code: "npx lucent sdk show UIKit.UIDevice.batteryLevel" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `// lucent:ios/UIKit
export declare class UIDevice extends NSObject {
  readonly batteryLevel: number;
}`,
  },
  {
    kind: "p",
    text: "`sdk show` prints what Lucent code sees: a class, or one member. Name it as `<module>.<Class>`, such as `UIKit.UIDevice` or `android.os.BatteryManager`. Doc comments say when a class is main-thread only, and the OS version each member needs.",
  },
  {
    kind: "p",
    text: "Your editor shows the same declarations, since `lucent build` writes them to `.lucent/native/types/`.",
  },
];

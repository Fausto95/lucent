import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "screen.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIApplication } from "lucent:ios/UIKit";
import { main } from "lucent:thread";

export async function keepAwake(on: boolean): Promise<void> {
  if (PLATFORM === "ios") {
    await main(() => {
      UIApplication.shared.isIdleTimerDisabled = on;
    });
  }
}`,
  },
  {
    kind: "p",
    text: "`main(f)` from `lucent:thread` runs `f` on the main thread and resolves with its result. The caller doesn't block, so call it from `async` code.",
  },
  {
    kind: "list",
    items: [
      "On iOS, APIs that Swift marks `@MainActor`, such as UIKit's, compile only inside `main()` (`LUCENT3006`). So do SDK callbacks the SDK calls on the main thread.",
      "`f` must be a function literal, and it can't be `async`. Keep it short: move data in and out, and do the work around it.",
      "Android has no such check. Some Android APIs still need the main thread, such as the clipboard; call them inside `main()` too.",
      "Objects that deliver to the thread that made them, such as `CLLocationManager`, should be made inside `main()`.",
    ],
  },
];

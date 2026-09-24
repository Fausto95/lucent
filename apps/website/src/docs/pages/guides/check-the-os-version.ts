import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "haptic.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style } from "lucent:ios/UIKit";
import { Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
import { available as availableOnIOS } from "lucent:ios";
import { main } from "lucent:thread";

export async function tap(): Promise<void> {
  if (PLATFORM === "ios") {
    await main(() => {
      const style = availableOnIOS("ios", 13) ? Style.soft : Style.light;
      new UIImpactFeedbackGenerator(style).impactOccurred();
    });
  } else {
    const context = appContext();
    const vibrator = available("android", 31)
      ? context.getSystemService(VibratorManager)?.defaultVibrator
      : context.getSystemService(Vibrator);
    vibrator?.vibrate(20);
  }
}`,
  },
  {
    kind: "list",
    items: [
      '`available("android", api)` from `lucent:android` is `Build.VERSION.SDK_INT >= api`. `available("ios", major, minor?)` from `lucent:ios` is Swift\'s `#available`.',
      "On Android, a class or member newer than API 24 compiles only behind such a check (`LUCENT3007`). `Build_VERSION.SDK_INT >= 31` works too, and so does an early return on the opposite check.",
      "On iOS, the compiler doesn't check versions yet: guard new APIs yourself. Each SDK member's doc comment says the version it needs.",
    ],
  },
];

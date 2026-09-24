import type { Block } from "../../types";
import { source } from "../../../generated/examples/haptics";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: UIKit's feedback generators may only run on the main thread, so each call is inside `main()`. The compiler rejects them anywhere else.",
      "Android: `available(\"android\", 31)` picks `VibratorManager` or `Vibrator`. Calling an API newer than the app's minimum without such a check is a compile error.",
      "It ships as an npm package, `lucent-haptics`, with the same API as `expo-haptics`.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "haptics.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import { ImpactFeedbackStyle, impactAsync, selectionAsync } from "lucent-haptics";

await impactAsync(ImpactFeedbackStyle.Heavy);
await selectionAsync();`,
      },
    ],
  },
  {
    kind: "p",
    text: "Source: [examples/lucent-haptics](https://github.com/Fausto95/lucent/tree/main/examples/lucent-haptics).",
  },
];

import type { Block } from "../../types";
import { source } from "../../../generated/examples/clipboard";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: `UIPasteboard.general`, read and written like a property.",
      "Android: `ClipboardManager`, called inside `main()` because Android lets only the focused app read the clipboard.",
      "`error(code, message)` from `lucent:core` throws an error JavaScript can tell apart by its `code`.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "clipboard.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import * as Clipboard from "./src/clipboard.lucent";

await Clipboard.setStringAsync("hello");
await Clipboard.getStringAsync(); // "hello"`,
      },
    ],
  },
  {
    kind: "p",
    text: "Source: [clipboard.lucent.ts](https://github.com/Fausto95/lucent/blob/main/scripts/example-app/src/sdk/clipboard.lucent.ts).",
  },
];

import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "diagram", diagram: "threads" },
  {
    kind: "table",
    head: ["Code", "Runs on"],
    rows: [
      ["A synchronous export, method or getter", "the JS thread, while JavaScript waits"],
      ["An `async` export or method", "the Lucent thread, a background thread"],
      ["Inside `main(() => …)`", "the main thread"],
      ["An SDK callback: a delegate, a listener, a block", "the Lucent thread, queued, unless the SDK waits for its result"],
      ["A JS callback called from async code", "the JS thread, posted there"],
    ],
  },
  { kind: "h2", text: "The one rule" },
  {
    kind: "p",
    text: "Lucent code runs one piece at a time, whatever thread it is on. Every entry into Lucent code holds one lock, and async code lets go of it only at an `await`. So two pieces of your code never run at once, and there are no data races to guard against.",
  },
  {
    kind: "p",
    text: "It's the rule JavaScript has, with one difference: a synchronous export waits while async Lucent code runs, until that code reaches an `await`. Keep long loops in `async` code, and `await` between chunks of work.",
  },
  { kind: "h2", text: "When you need `main()`" },
  {
    kind: "code",
    filename: "screen.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIScreen } from "lucent:ios/UIKit";
import { main } from "lucent:thread";

export async function brightness(): Promise<number> {
  if (PLATFORM === "ios") {
    return main(() => UIScreen.main.brightness);
  } else {
    return -1;
  }
}`,
  },
  {
    kind: "p",
    text: "UIKit and other main-thread APIs compile only inside `main()`, or in a callback the SDK already calls on the main thread (`LUCENT3006`). `main()` returns a promise, so the caller doesn't block. The function you pass can't be `async`.",
  },
  {
    kind: "p",
    text: "Android has no such check at compile time. Some Android APIs still need the main thread, such as the clipboard: call them inside `main()` too.",
  },
];

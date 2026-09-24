import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "module",
        filename: "search.lucent.ts",
        code: `import { delay } from "lucent:core";

export async function search(words: string[], query: string, signal: AbortSignal): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i % 1000 === 0) {
      signal.throwIfAborted();
      await delay(0); // let other calls in between chunks
    }
    const word = words[i]!;
    if (word.includes(query)) found.push(word);
  }
  return found;
}`,
      },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `const controller = new AbortController();
const results = search(words, "lu", controller.signal);

controller.abort(); // results rejects with an AbortError`,
      },
    ],
  },
  {
    kind: "p",
    text: "Pass an `AbortSignal` from JavaScript. When JavaScript calls `abort()`, the signal is set in native code at once. Your code stops where it checks: `signal.throwIfAborted()`, or a `delay(ms, signal)`.",
  },
  {
    kind: "list",
    items: [
      "The rejection is an `Error` named `AbortError`, or the reason JavaScript passed to `abort()`.",
      "`signal.aborted` reads the state, and `signal.addEventListener(\"abort\", …)` runs a function when it's set.",
      "A signal can come into Lucent, but not go back out, and an `AbortController` can't cross at all.",
    ],
  },
];

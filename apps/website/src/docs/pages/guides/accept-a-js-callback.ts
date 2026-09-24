import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "callbacks.lucent.ts",
    code: `/** Synchronous: the callback runs while JavaScript waits, and may return a value. */
export function sortBy(words: string[], key: (word: string) => number): string[] {
  return [...words].sort((a, b) => key(a) - key(b));
}

/** From async code: the callback is posted to the JS thread, so it returns void. */
export async function countTo(n: number, onStep: (step: number) => void): Promise<void> {
  for (let i = 1; i <= n; i++) onStep(i);
}

/** Returning a Promise lets async code wait for JavaScript's answer. */
export async function askTwice(ask: (question: string) => Promise<number>): Promise<number> {
  const a = await ask("first");
  const b = await ask("second");
  return a + b;
}`,
  },
  {
    kind: "table",
    head: ["Called from", "The callback", "It may return"],
    rows: [
      ["a synchronous export", "runs at once, on the JS thread", "any value that can cross; it's checked"],
      ["async code", "is posted to the JS thread", "`void`, or a `Promise` that Lucent can `await`"],
    ],
  },
  {
    kind: "list",
    items: [
      "A callback that throws, or whose promise rejects, throws in Lucent too: `catch` it there.",
      "Lucent keeps a callback while it holds a reference to it, and releases it on the JS thread after.",
      "After a reload, a stale `void` callback does nothing; one that returns a value throws.",
    ],
  },
];

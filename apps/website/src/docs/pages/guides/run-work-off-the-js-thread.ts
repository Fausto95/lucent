import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "primes.lucent.ts",
    code: `/** Counts the primes below \`limit\`, on the Lucent thread. */
export async function countPrimes(limit: number): Promise<number> {
  const composite = new Uint8Array(limit);
  let count = 0;
  for (let n = 2; n < limit; n++) {
    if (composite[n] === 1) continue;
    count++;
    for (let m = n * n; m < limit; m += n) composite[m] = 1;
  }
  return count;
}`,
  },
  {
    kind: "code",
    filename: "App.tsx",
    code: `const count = await countPrimes(10_000_000); // the JS thread stays free meanwhile`,
  },
  {
    kind: "p",
    text: "An `async` export runs on the Lucent thread, a background thread, from its first line. Its arguments are checked and copied on the JS thread first, and its result resolves the promise there.",
  },
  {
    kind: "list",
    items: [
      "`async` methods of exported classes run the same way.",
      "Lucent code runs one piece at a time. A synchronous call from JavaScript waits while async Lucent code runs, until that code reaches an `await`.",
      "So in long work that JavaScript may call into meanwhile, `await delay(0)` from `lucent:core` now and then lets synchronous calls through.",
    ],
  },
  {
    kind: "note",
    text: "A synchronous export returning a `Promise`, without `async`, runs on the JS thread. Mark exports `async` to move them off it.",
  },
];

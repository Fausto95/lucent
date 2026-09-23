import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/async",
  title: "Async & concurrency",
  description: "Async functions compile to C++20 coroutines that interleave like JavaScript's, and exported async functions run off the JS thread.",
  blocks: [
    { kind: "h2", text: "async and await" },
    {
      kind: "p",
      text: "`async` functions, methods and arrow functions, `await`, `Promise.all`, `Promise.resolve` and `Promise.reject` work as in JavaScript. Timing comes from `delay(ms, signal?)` in `@lucent-lang/core`, the equivalent of a `setTimeout` wrapped in a promise.",
    },
    {
      kind: "code",
      filename: "jobs.lucent.ts",
      code: `import { delay } from "@lucent-lang/core";

async function fetchScore(id: number): Promise<number> {
  await delay(10);
  return id * 2;
}

export async function scores(ids: number[]): Promise<number[]> {
  return Promise.all(ids.map((id) => fetchScore(id)));
}

export async function firstPositive(ids: number[]): Promise<number | undefined> {
  for (const id of ids) {
    const score = await fetchScore(id);
    if (score > 0) return score;
  }
  return undefined;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { scores } from "./jobs.lucent";

const result = await scores([1, 2, 3]); // [2, 4, 6]`,
    },
    {
      kind: "p",
      text: "Ordering matches JavaScript: an async function runs synchronously until its first `await`, and every `await` resumes from the microtask queue. `Promise.all` rejects as soon as one promise rejects, and in a destructured `Promise.all([a(), b()])` each element keeps its own type.",
    },
    {
      kind: "p",
      text: "Not supported: `new Promise(executor)`, `Promise.race`, `Promise.allSettled`, `for await` and async generators. `setTimeout` does not exist in a Lucent module; use `delay`.",
    },
    { kind: "h2", text: "Cancellation" },
    {
      kind: "p",
      text: "`AbortSignal` (`aborted`, `throwIfAborted()`, `addEventListener(\"abort\", listener)`) and `AbortController` (`signal`, `abort(error?)`) are supported. `delay(ms, signal)` rejects with the abort reason. A signal created by JavaScript can be passed to an exported function, and aborting it on the JS side aborts the native side immediately.",
    },
    {
      kind: "code",
      filename: "poll.lucent.ts",
      code: `import { delay } from "@lucent-lang/core";

export async function poll(check: () => Promise<boolean>, signal: AbortSignal): Promise<number> {
  let attempts = 0;
  while (!(await check())) {
    attempts++;
    await delay(500, signal); // rejects once the signal aborts
  }
  return attempts;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `const controller = new AbortController();
poll(async () => isReady(), controller.signal).catch((e) => console.log(e.name)); // "AbortError"
controller.abort();`,
    },
    {
      kind: "p",
      text: "`signal.reason` is not available; catch the error instead. An `AbortController` cannot cross the boundary, and signals cannot be returned to JavaScript.",
    },
    { kind: "h2", text: "Which thread runs what" },
    {
      kind: "diagram",
      diagram: "runtime",
      caption: "Synchronous exports run on the JS thread; async exports start on the Lucent thread. One lock serializes all Lucent code.",
    },
    {
      kind: "p",
      text: "Lucent code runs **one piece at a time**, like JavaScript. Every entry into Lucent code holds a single Lucent lock, so Lucent code never races with itself and there are no data races to guard against.",
    },
    {
      kind: "table",
      head: ["Call", "Runs on", "Result"],
      rows: [
        ["synchronous exported function", "the JS thread, directly", "returned to the caller"],
        ["`async` exported function", "the Lucent thread, a single background thread for jobs and timers", "a JS promise, resolved on the JS thread"],
        ["callback called from sync code", "the JS thread, synchronously", "may return a value"],
        ["callback called from async code", "posted to the JS thread", "must return `void` or a `Promise`"],
      ],
    },
    {
      kind: "p",
      text: "An `async` export is how you move heavy work off the JS thread. Inside it, awaits interleave with other Lucent async work exactly as in JavaScript.",
    },
    {
      kind: "note",
      tone: "warn",
      text: "Because of the single lock, while a long async computation runs, synchronous calls from JavaScript wait for it to reach an `await`, and the JS thread waits with them. Keep synchronous exports short, make heavy ones `async`, and give long async loops an occasional `await delay(0)` so waiting calls can get in.",
    },
    {
      kind: "p",
      text: "How callbacks and promises cross the boundary in detail is covered in [Callbacks](/docs/boundary/callbacks/).",
    },
  ],
};

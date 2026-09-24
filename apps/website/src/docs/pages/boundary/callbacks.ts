import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "boundary/callbacks",
  title: "Callbacks",
  description: "Passing JavaScript functions and abort signals to Lucent, and which thread they run on.",
  blocks: [
    {
      kind: "p",
      text: "A parameter with a function type accepts a JavaScript function. Lucent keeps the function alive while it holds it, and releases it on the JS thread when it drops it. JavaScript functions can only run on the JS thread, so what happens when Lucent calls one depends on where the call comes from.",
    },
    {
      kind: "table",
      head: ["Lucent calls the callback…", "It runs", "It may return"],
      rows: [
        ["during a synchronous export (on the JS thread)", "Synchronously, before the call returns", "Any type that can cross; the result is checked like an argument"],
        ["from async code (on the Lucent thread)", "Later, posted to the JS thread", "`void`, or a `Promise` that Lucent can `await`"],
      ],
    },
    { kind: "h2", text: "Synchronous callbacks" },
    {
      kind: "code",
      filename: "text.lucent.ts",
      code: `export function sortWith(items: string[], compare: (a: string, b: string) => number): string[] {
  return items.slice().sort(compare);
}

export function countMatching(words: string[], test: (word: string) => boolean): number {
  let count = 0;
  for (const w of words) if (test(w)) count++;
  return count;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { sortWith, countMatching } from "./text.lucent";

sortWith(["b", "a", "c"], (a, b) => b.localeCompare(a)); // ["c", "b", "a"]
countMatching(["tea", "toast", "jam"], (w) => w.startsWith("t")); // 2`,
    },
    {
      kind: "p",
      text: "The callback's return value is validated against its declared type: returning a string from `test` throws a `TypeError` that names the callback.",
    },
    { kind: "h2", text: "Callbacks from async code" },
    {
      kind: "p",
      text: "Async exports run on the Lucent thread, which cannot call into JavaScript directly. A callback called there is posted to the JS thread, so Lucent cannot wait for a plain return value. Declare it to return `void` (fire and forget) or a `Promise` (awaitable):",
    },
    {
      kind: "code",
      filename: "sync.lucent.ts",
      code: `import { delay } from "lucent:core";

export async function upload(parts: number, onProgress: (done: number, total: number) => void): Promise<string> {
  for (let i = 1; i <= parts; i++) {
    await delay(20);
    onProgress(i, parts);
  }
  return "uploaded";
}

export async function syncAll(names: string[], confirm: (name: string) => Promise<boolean>): Promise<number> {
  let synced = 0;
  for (const name of names) {
    if (await confirm(name)) synced++;
  }
  return synced;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { upload, syncAll } from "./sync.lucent";

await upload(4, (done, total) => setProgress(done / total));
await syncAll(["photos", "notes"], async (name) => askUser(\`Sync \${name}?\`));`,
    },
    {
      kind: "list",
      items: [
        "A rejected promise, or an exception thrown by an awaited callback, becomes an error that Lucent code can `catch` (see [Errors across the boundary](/docs/boundary/errors/)).",
        "An exception thrown by a `void` callback posted from async code has nowhere to go: it is logged as `Uncaught error in callback` and the Lucent code keeps running.",
        "A callback that returns a value, called from async code, throws `a callback that returns a value can only be called synchronously; make it return a Promise`.",
      ],
    },
    {
      kind: "p",
      text: "Posted callbacks run in order, on a later turn of the JS thread. By the time `upload` resolves, every `onProgress` call it made has run.",
    },
    { kind: "h2", text: "Keeping a callback" },
    {
      kind: "p",
      text: "Callbacks can be stored, for example in a class field, and called later. The same rules apply at each call: from a synchronous call they run immediately; from async code they are posted. If JavaScript reloads while Lucent still holds a callback, later calls to it do nothing (or throw, if they must return a value).",
    },
    {
      kind: "code",
      filename: "store.lucent.ts",
      code: `export class Store {
  private listeners: ((count: number) => void)[] = [];
  private count = 0;

  subscribe(listener: (count: number) => void): void {
    this.listeners.push(listener);
  }

  increment(): void {
    this.count++;
    for (const l of this.listeners) l(this.count);
  }
}`,
    },
    { kind: "h2", text: "Cancellation with AbortSignal" },
    {
      kind: "p",
      text: "An `AbortSignal` parameter accepts a signal from a JavaScript `AbortController`. When JavaScript calls `abort()`, the native signal aborts in the same turn: `delay(ms, signal)` rejects, `signal.aborted` becomes true, and listeners added with `addEventListener(\"abort\", …)` run.",
    },
    {
      kind: "code",
      filename: "search.lucent.ts",
      code: `import { delay } from "lucent:core";

export async function search(query: string, signal: AbortSignal): Promise<string[]> {
  const results: string[] = [];
  for (let page = 1; page <= 10; page++) {
    signal.throwIfAborted();
    await delay(50, signal);
    results.push(\`\${query} #\${page}\`);
  }
  return results;
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { search } from "./search.lucent";

const controller = new AbortController();
const pending = search("lucent", controller.signal);
controller.abort();
await pending; // rejects with AbortError: signal is aborted without reason`,
    },
    {
      kind: "p",
      text: "Signals only go from JavaScript to Lucent: an `AbortSignal` cannot be returned, and an `AbortController` cannot cross at all. Inside Lucent, `new AbortController()` works as in JavaScript. See [Async](/docs/language/async/) for `delay` and cancellation inside Lucent.",
    },
  ],
};

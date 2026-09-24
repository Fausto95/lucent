import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "reference/core",
  title: "lucent:core",
  description: "The helpers Lucent modules can import, and the editor plugin that shows Lucent diagnostics as you type.",
  blocks: [
    {
      kind: "p",
      text: "`lucent:core` is a module built into the compiler, like `lucent:thread`: nothing to install. It holds the helpers every Lucent module may import, each with a native implementation in the Lucent runtime.",
    },
    { kind: "h2", text: "Exports" },
    {
      kind: "table",
      head: ["Signature", "Description"],
      rows: [
        ["`delay(ms: number, signal?: AbortSignal): Promise<void>`", "Resolves after `ms` milliseconds; rejects with the signal's reason if it aborts first."],
        ["`error(code: string, message: string): Error`", "An `Error` with a machine-readable `code`, visible to JavaScript as `error.code`."],
        ["`errorCode(e: Error): string | undefined`", "The `code` of an error created with `error()` (or received from JavaScript with a string `code`), or `undefined`."],
        ["`utf8Encode(s: string): Uint8Array`", "UTF-8 encoding of a string, like `new TextEncoder().encode(s)`."],
        ["`utf8Decode(bytes: Uint8Array): string`", "Decodes UTF-8 bytes, like `new TextDecoder().decode(b)`, replacing invalid sequences."],
        ["`now(): number`", "Milliseconds from a monotonic clock, for measuring durations. Use `Date.now()` for wall-clock time."],
      ],
    },
    {
      kind: "code",
      filename: "checksum.lucent.ts",
      code: `import { delay, error, errorCode, now, utf8Decode, utf8Encode } from "lucent:core";

export function checksum(text: string): number {
  let sum = 0;
  for (const b of utf8Encode(text)) sum = (sum * 31 + b) >>> 0;
  return sum;
}

export function roundTrip(text: string): string {
  return utf8Decode(utf8Encode(text));
}

export function parseLevel(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) throw error("E_LEVEL", \`not a level: \${text}\`);
  return n;
}

export function levelOr(text: string, fallback: number): number {
  try {
    return parseLevel(text);
  } catch (e) {
    if (errorCode(e as Error) === "E_LEVEL") return fallback;
    throw e;
  }
}

export async function timed(ms: number, signal?: AbortSignal): Promise<number> {
  const start = now();
  await delay(ms, signal);
  return now() - start;
}`,
    },
    {
      kind: "p",
      text: "Everything else a module uses is built in: `Math`, `JSON`, `Date`, `Map`, `RegExp`, `console`, `AbortController` and the rest listed in the [Language overview](/docs/language/). `lucent:core` holds only what JavaScript has no standard spelling for in React Native.",
    },
    { kind: "h2", text: "Editor plugin" },
    {
      kind: "p",
      text: "`@lucent-lang/lucent/ts-plugin` is a TypeScript language-service plugin. It shows Lucent diagnostics on `*.lucent.ts` files as you type, next to TypeScript's own, including in unsaved buffers.",
    },
    {
      kind: "steps",
      steps: [
        {
          title: "Add it to tsconfig.json",
          blocks: [
            {
              kind: "code",
              filename: "tsconfig.json",
              code: `{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "plugins": [{ "name": "@lucent-lang/lucent/ts-plugin" }]
  }
}`,
            },
            {
              kind: "p",
              text: "`noUncheckedIndexedAccess` makes your editor check what the compiler checks: Lucent always builds with `strict` and `noUncheckedIndexedAccess`.",
            },
          ],
        },
        {
          title: "Use the workspace TypeScript",
          blocks: [
            {
              kind: "p",
              text: "tsserver only loads plugins from the project's TypeScript. In VS Code, run **TypeScript: Select TypeScript Version** and pick **Use Workspace Version**.",
            },
          ],
        },
      ],
    },
    {
      kind: "code",
      filename: "editor",
      code: "src/geo.lucent.ts:2:3  LUCENT1001: use `let` or `const` instead of `var`",
    },
    {
      kind: "p",
      text: "The plugin reports the same codes as `lucent build` ([Diagnostics](/docs/language/diagnostics/)). It leaves TypeScript errors to TypeScript. For platform files it reports Lucent diagnostics, but tsserver itself does not resolve `lucent:*` imports yet, so expect unresolved-module errors on those lines.",
    },
  ],
};

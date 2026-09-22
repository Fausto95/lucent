import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/async-and-errors",
  title: "Async & errors",
  description: "`async` functions become Swift `async` and Kotlin `suspend`. `LucentError` is the one way to fail.",
  blocks: [
    { kind: "h2", text: "Async functions" },
    {
      kind: "p",
      text: "An `async` function must declare `Promise<T>`; a sync one must not. `Promise` is legal nowhere else: not in record fields, not as a parameter. `await` is only valid inside an `async` function.",
    },
    {
      kind: "code",
      filename: "async-sum.lucent.ts",
      code: "async function scale(value: number): Promise<number> {\n  return value * 2;\n}\n\nexport async function total(values: number[]): Promise<number> {\n  let sum = 0;\n  for (const value of values) {\n    sum += value;\n  }\n  return await scale(sum);\n}",
    },
    {
      kind: "list",
      items: [
        "On Expo the function is exposed as an `AsyncFunction` (Kotlin coroutine, Swift `async throws`); on Nitro as a `Promise`.",
        "Async functions receive a **copy** of any `Uint8Array` argument, since the native work may outlive the call.",
        "Async functions cannot accept [native class](/docs/language/native-classes/) instances as arguments.",
        "[Thread hops](/docs/language/threads/) require an async function.",
      ],
    },
    { kind: "h2", text: "Throwing" },
    {
      kind: "p",
      text: "`LucentError` is a global the compiler knows; it needs no import. Throw it with a code, an optional message and optional scalar metadata. Any other thrown value is `LUCENT1001`.",
    },
    {
      kind: "code",
      filename: "throw.lucent.ts",
      code: 'export function divide(a: number, b: number): number {\n  if (b === 0) {\n    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });\n  }\n  return a / b;\n}\n\nexport function missing(path: string): void {\n  throw new LucentError("MISSING", {\n    message: "File not found",\n    metadata: { path, attempt: 1, retry: false, detail: null },\n  });\n}',
    },
    {
      kind: "p",
      text: "The app receives an `Error` subclass with `code`, `message` and `metadata`, identically on Expo and Nitro. The envelope preserves Unicode and newlines and never exposes native stack traces. See [`@lucent-lang/runtime`](/docs/api/runtime/).",
    },
    {
      kind: "table",
      head: ["Rule", "Detail"],
      rows: [
        ["Metadata values", "`string`, `number`, `boolean` or `null`. Nested objects and arrays are rejected. Non-finite numbers become `null`."],
        ["No `try` / `catch`", "Native code cannot catch. Errors propagate to the JavaScript caller."],
        ["Package binding errors", "Use the same mechanism: a binding body throws `LucentError` with its own code and metadata, for example `FILE_READ` with `metadata.path`."],
      ],
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { divide } from "./src/throw.lucent";\n\ntry {\n  divide(1, 0);\n} catch (error) {\n  if (error instanceof Error && "code" in error) {\n    error.code; // "DIVIDE_BY_ZERO"\n  }\n}',
    },
  ],
};

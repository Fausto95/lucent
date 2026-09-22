import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/threads",
  title: "Threads",
  description: "A decorator selects where a function runs: the caller's context, the main thread, or a worker. A thread hop is asynchronous.",
  blocks: [
    {
      kind: "code",
      filename: "work.lucent.ts",
      code: "// @ts-expect-error Lucent function decorator; compiled before TypeScript.\n@Background\nexport async function double(value: number): Promise<number> {\n  return value * 2;\n}\n\n// @ts-expect-error Lucent function decorator; compiled before TypeScript.\n@MainThread\nexport async function title(): Promise<string> {\n  return \"ready\";\n}",
    },
    {
      kind: "table",
      head: ["Decorator", "Swift", "Kotlin"],
      rows: [
        ["`@Inherited` (default)", "caller's context", "caller's context"],
        ["`@MainThread`", "main actor", "`Dispatchers.Main`"],
        ["`@Background`", "detached task", "`Dispatchers.Default`"],
      ],
    },
    { kind: "h2", text: "Rules" },
    {
      kind: "list",
      items: [
        "`@MainThread` and `@Background` require an `async` function. The app receives a promise.",
        "Decorators take no arguments and apply to top-level functions, including private helpers.",
        "Function decorators are a Lucent extension, not TypeScript method decorators. Put `// @ts-expect-error …` on the line before so the editor's TypeScript stays quiet; Lucent compiles the file before Metro hands the proxy to TypeScript tooling.",
        "A decorator does not make shared state safe. [Native class](/docs/language/native-classes/) arguments stay restricted to synchronous functions.",
        "Legacy `/** @thread … */` comments are rejected with a migration diagnostic.",
      ],
    },
    { kind: "h2", text: "Main-thread cost warnings" },
    {
      kind: "p",
      text: "`LUCENT3002` warns when a `@MainThread` function reaches a loop, recursion, or a binding whose manifest marks it `cost: \"cpu\"` or `\"io\"`, including through private helpers. An explicit `@Background` hop stops the propagation. Warnings are kept on cache hits and never fail the build. This is conservative static analysis, not a runtime duration guarantee.",
    },
    {
      kind: "p",
      text: "A package binding declares its own execution context, so I/O bindings can already hop to a worker. Anything left on the caller is synchronous; wrap expensive work in a `@Background` function.",
    },
  ],
};

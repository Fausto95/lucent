import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "boundary/errors",
  title: "Errors across the boundary",
  description: "How Lucent errors reach JavaScript, how JavaScript exceptions reach Lucent, and how native crashes map back to your source.",
  blocks: [
    {
      kind: "p",
      text: "Errors cross in both directions and keep what matters: `name`, `message`, a machine-readable `code`, and a `stack` that points at the right source. How to throw and catch inside Lucent is covered in [Errors](/docs/language/errors/).",
    },
    { kind: "h2", text: "From Lucent to JavaScript" },
    {
      kind: "code",
      filename: "config.lucent.ts",
      code: `import { error } from "lucent:core";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function port(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n)) throw error("E_PORT", \`not a port: \${text}\`);
  if (n < 1 || n > 65535) throw new RangeError(\`port out of range: \${n}\`);
  return n;
}

export function host(text: string): string {
  if (text.length === 0) throw new ConfigError("host is empty");
  return text;
}

export async function load(text: string): Promise<number> {
  return port(text);
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { port, host, load } from "./config.lucent";

try {
  port("http");
} catch (e) {
  e instanceof Error; // true
  e.code; // "E_PORT"
  e.message; // "not a port: http"
  e.stack; // "Error: not a port: http\\n    at port (/app/src/config.lucent.ts:12)\\n    at …"
}

try { port("70000"); } catch (e) { e instanceof RangeError; } // true
try { host(""); } catch (e) { e.name; } // "ConfigError"
await load("x").catch((e) => e.code); // "E_PORT"`,
    },
    {
      kind: "table",
      head: ["Thrown in Lucent", "Caught in JavaScript"],
      rows: [
        ["`new Error(m)`", "`Error` with the same `message`"],
        ["`new TypeError(m)`, `new RangeError(m)`", "`TypeError`, `RangeError`"],
        ["`error(code, m)` from `lucent:core`", "`Error` whose `code` is `code`"],
        ["`class X extends Error`", "`Error` whose `name` is the class's `name`; other fields are not copied"],
      ],
    },
    {
      kind: "list",
      items: [
        "The first line of `stack` below the message is the Lucent frame that created the error: the function, the absolute path of the `.lucent.ts` file and the line. The JavaScript frames of the caller follow.",
        "Async exports reject their promise with the same error.",
        "Invalid arguments throw a `TypeError` before the function runs (see [Argument validation](/docs/boundary/conversions/#argument-validation)). This happens synchronously, even for async exports, so a `.catch()` on the returned promise does not see it; `await` inside `try` does.",
        "Errors thrown by the runtime, such as an out-of-range array write or a failed `!`, are ordinary `TypeError`s and `RangeError`s.",
      ],
    },
    { kind: "h2", text: "From JavaScript to Lucent" },
    {
      kind: "p",
      text: "An exception thrown by a JavaScript [callback](/docs/boundary/callbacks/), or a rejected promise it returns, becomes a Lucent error that `catch` can handle. It keeps its `name`, `message` and `code`. If it is rethrown and reaches JavaScript again, it keeps its original JavaScript `stack`, so the frame that threw is not lost.",
    },
    {
      kind: "code",
      filename: "jobs.lucent.ts",
      code: `import { errorCode } from "lucent:core";

export async function runAll(jobs: string[], run: (job: string) => Promise<void>): Promise<string[]> {
  const failed: string[] = [];
  for (const job of jobs) {
    try {
      await run(job);
    } catch (e) {
      failed.push(\`\${job}: \${errorCode(e as Error) ?? (e as Error).message}\`);
    }
  }
  return failed;
}

export function each(items: string[], visit: (item: string) => void): void {
  for (const item of items) visit(item); // a throw in visit propagates to the caller
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { runAll } from "./jobs.lucent";

await runAll(["a", "b"], async (job) => {
  if (job === "b") throw Object.assign(new Error("offline"), { code: "E_NET" });
});
// ["b: E_NET"]`,
    },
    { kind: "h2", text: "Native crashes" },
    {
      kind: "p",
      text: "Lucent throws where JavaScript would, so most mistakes surface as catchable errors. Some cannot: very deep recursion can overflow the native stack instead of throwing `RangeError` (see [Differences from JavaScript](/docs/language/differences/)).",
    },
    {
      kind: "p",
      text: "The generated C++ carries `#line` directives that point at your `.lucent.ts` files, so the debug information does too. Crash reports symbolicated with the app's dSYM (iOS) or unstripped `.so` files (Android) name the `.lucent.ts` file and line, and a native debugger steps through your TypeScript source.",
    },
  ],
};

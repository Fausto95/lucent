import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "module",
        filename: "config.lucent.ts",
        code: `import { error, errorCode } from "lucent:core";

export type Config = { name: string; retries: number };

export function parseConfig(text: string): Config {
  if (text.trim().length === 0) throw error("E_EMPTY", "The config is empty");
  return JSON.parse(text) as Config;
}

export function retriesOr(text: string, fallback: number): number {
  try {
    return parseConfig(text).retries;
  } catch (e) {
    if (e instanceof Error && errorCode(e) === "E_EMPTY") return fallback;
    throw e;
  }
}`,
      },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `try {
  parseConfig("");
} catch (e) {
  if ((e as { code?: string }).code === "E_EMPTY") showDefaults();
  else throw e;
}`,
      },
    ],
  },
  {
    kind: "list",
    items: [
      "`error(code, message)` from `lucent:core` makes an `Error` with a `code`. Test the code, not the message.",
      "JavaScript receives an `Error`, `TypeError` or `RangeError`, with the same `name`, `message` and `code`. Its stack starts at the line that made the error.",
      "Only `Error` values can be thrown (`LUCENT1006`). Subclasses reach JavaScript as plain errors, with their name, message and code.",
      "An async export's error rejects its promise. A JS callback's error, or a rejected promise you `await`, is thrown in Lucent, with its `code`.",
      "SDK errors arrive the same way: a Java exception's `code` is its class, and an `NSError`'s is `domain:code`.",
    ],
  },
  {
    kind: "p",
    text: "An error that nothing catches in an SDK callback is logged: `[lucent] uncaught exception in …`, in the unified log on iOS and logcat on Android.",
  },
];

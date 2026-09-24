import type { Block } from "../../types";

export const blocks: Block[] = [
    { kind: "h2", text: "Throwing and catching" },
    {
      kind: "p",
      text: "`Error`, `TypeError`, `RangeError` and your own subclasses of `Error` can be thrown and caught. `try`/`catch`/`finally` behave as in JavaScript, including `return`, `break` and `continue` inside `try` (the `finally` block runs first) and `catch` without a binding. Every error has `name`, `message` and `stack`.",
    },
    {
      kind: "code",
      filename: "validate.lucent.ts",
      code: `export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
    this.name = "ValidationError";
  }
}

export function checkAge(age: number): number {
  if (!Number.isInteger(age)) throw new TypeError("age must be an integer");
  if (age < 0) throw new ValidationError("age", "age must be positive");
  return age;
}

export function explain(age: number): string {
  try {
    return \`ok: \${checkAge(age)}\`;
  } catch (e) {
    if (e instanceof ValidationError) return \`invalid \${e.field}: \${e.message}\`;
    if (e instanceof Error) return \`\${e.name}: \${e.message}\`;
    throw e;
  }
}`,
    },
    {
      kind: "p",
      text: "The caught value is `unknown`, as in strict TypeScript. Narrow it with `instanceof`, or assert with `e as Error` when you know every error in the `try` block is one. `unknown` is only allowed in this position.",
    },
    {
      kind: "p",
      text: "Classes can extend `Error` but no other built-in class. A subclass sets its own `name` if it should differ from `\"Error\"`.",
    },
    { kind: "h2", text: "Error codes" },
    {
      kind: "p",
      text: "`error(code, message)` from `lucent:core` creates an `Error` with a machine-readable `code`, and `errorCode(e)` reads it back (or returns `undefined`). JavaScript sees the code as `error.code`, which is the usual way to let callers branch on a failure without parsing messages.",
    },
    {
      kind: "code",
      filename: "math.lucent.ts",
      code: `import { error, errorCode } from "lucent:core";

export function divide(a: number, b: number): number {
  if (b === 0) throw error("DIVIDE_BY_ZERO", "cannot divide by zero");
  return a / b;
}

export function safeDivide(a: number, b: number): number | undefined {
  try {
    return divide(a, b);
  } catch (e) {
    if (e instanceof Error && errorCode(e) === "DIVIDE_BY_ZERO") return undefined;
    throw e;
  }
}`,
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: `import { divide } from "./math.lucent";

try {
  divide(1, 0);
} catch (e) {
  console.log(e.code, e.message); // "DIVIDE_BY_ZERO" "cannot divide by zero"
}`,
    },
    { kind: "h2", text: "Only Error values can be thrown" },
    {
      kind: "p",
      text: "Throwing a string, number or plain object is a compile error. Wrap the value in an `Error`, or use `error(code, message)` if you want to carry a code.",
    },
    {
      kind: "code",
      filename: "port.lucent.ts",
      expect: "LUCENT1006",
      code: `export function parsePort(text: string): number {
  const port = Number(text);
  if (!Number.isInteger(port)) throw \`not a port: \${text}\`;
  return port;
}`,
    },
    { kind: "h2", text: "Errors from the runtime" },
    {
      kind: "p",
      text: "Where native code cannot do what JavaScript would, it throws instead of silently doing something different. The common ones:",
    },
    {
      kind: "table",
      head: ["Situation", "Error"],
      rows: [
        ["`x!` on a value that is `undefined` or `null`", "`TypeError`"],
        ["`arr[i] = v` with `i > arr.length`", "`RangeError`"],
        ["`JSON.parse` text that does not match the target type", "`TypeError` naming the path"],
        ["`delay(ms, signal)` or `signal.throwIfAborted()` after an abort", "the abort reason (an `AbortError` by default)"],
      ],
    },
    {
      kind: "p",
      text: "How errors cross to JavaScript (class, `name`, `message`, `code`, and a `stack` that starts at the Lucent source line) and how JavaScript exceptions thrown by callbacks become catchable Lucent errors is covered in [Errors at the boundary](/docs/boundary/errors/).",
    },
];

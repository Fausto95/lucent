import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "A synchronous call" },
  { kind: "diagram", diagram: "call-sync" },
  {
    kind: "list",
    ordered: true,
    items: [
      "The proxy hands the call to the `Lucent` TurboModule, through JSI.",
      "Argument conversion checks each value against its parameter's type, then copies it into C++.",
      "Your C++ runs on the JS thread, while JavaScript waits for it.",
      "Return conversion turns the C++ result into a JavaScript value.",
    ],
  },
  {
    kind: "p",
    text: "A wrong value never reaches your code. It throws a `TypeError` that names the function and the argument:",
  },
  { kind: "code", filename: "terminal", copy: false, code: "TypeError: greet: argument 'name' must be a string, got a number" },
  { kind: "h2", text: "An async call" },
  { kind: "diagram", diagram: "call-async" },
  {
    kind: "code",
    filename: "stats.lucent.ts",
    code: `export async function mean(values: number[]): Promise<number> {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length > 0 ? sum / values.length : 0;
}`,
  },
  {
    kind: "list",
    items: [
      "The arguments are checked and copied on the JS thread, so a wrong value throws at once rather than rejecting.",
      "The body runs on the Lucent thread, a background thread, from its first line.",
      "The result is posted back to the JS thread, converted, and resolves the promise. A thrown error rejects it instead.",
    ],
  },
  {
    kind: "p",
    text: "All Lucent code runs under one lock, one piece at a time, like JavaScript. A synchronous call waits while async Lucent code runs, until that code reaches an `await`.",
  },
  { kind: "h2", text: "What crosses the boundary" },
  {
    kind: "p",
    text: "Numbers, strings, arrays and objects are copied. Class instances cross by reference and keep their identity, functions become callbacks, and promises stay promises. [Type conversions](/docs/boundary/conversions/) has every type.",
  },
];

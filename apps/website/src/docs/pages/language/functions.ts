import type { Block } from "../../types";

export const blocks: Block[] = [
    { kind: "h2", text: "Statements and expressions" },
    {
      kind: "table",
      head: ["Area", "Supported"],
      rows: [
        ["Declarations", "`let`, `const` (not `var`)"],
        ["Control flow", "`if`, `while`, `do…while`, `for`, `switch` with fallthrough, labels with `break`/`continue`, `try`/`catch`/`finally`, `throw`"],
        ["Loops over values", "`for…of` over arrays, strings (by code point), `Map`, `Set`, records, `Uint8Array`, generators; `for…in` over records and object types"],
        ["Operators", "all arithmetic, comparison, bitwise, logical and assignment operators, including `??=`, `||=`, `&&=`; `&&`, `||` and `??` return an operand, as in JS"],
        ["Access", "optional chaining (`a?.b`, `a?.[i]`, `f?.()`), non-null `x!` (checked at run time)"],
        ["Other", "template literals, spread in arrays, calls and object literals, `typeof`, `instanceof`, `in` on records"],
      ],
    },
    {
      kind: "p",
      text: "Operands and arguments are evaluated left to right, as in JavaScript, even where C++ would leave the order unspecified.",
    },
    { kind: "h2", text: "Functions" },
    {
      kind: "p",
      text: "Function declarations (including nested ones, which are hoisted), function expressions and arrow functions all work, as do default parameter values and recursion. Rest parameters (`...xs: T[]`) are not supported yet; take an array instead. Spread in calls works for built-ins such as `Math.max(...xs)` and `push(...xs)`.",
    },
    { kind: "h2", text: "Destructuring" },
    {
      kind: "p",
      text: "Array and object patterns work in declarations, parameters, `for…of` and assignments, with defaults, renaming, nesting and array rest. Object rest (`const { a, ...others } = o`) is not supported (`LUCENT1004`).",
    },
    {
      kind: "code",
      filename: "people.lucent.ts",
      code: `export type Person = { name: string; age: number; nickname?: string; tags: string[] };

export function summary({ name, age: years, nickname = "none", tags }: Person): string {
  const [first = "untagged", ...rest] = tags;
  return \`\${name} (\${years}), aka \${nickname}: \${first} +\${rest.length}\`;
}

export function fib(n: number): number {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}`,
    },
    { kind: "h2", text: "Closures" },
    {
      kind: "p",
      text: "Closures capture variables by reference: a closure and its enclosing scope see the same variable, and writes on either side are visible to the other. A `let` loop variable gets a fresh binding per iteration, so each closure created in the loop keeps its own value.",
    },
    {
      kind: "code",
      filename: "closures.lucent.ts",
      code: `export function counter(): number {
  let count = 0;
  const inc = () => {
    count++;
  };
  inc();
  inc();
  return count; // 2
}

export function adders(): number[] {
  const fns: ((x: number) => number)[] = [];
  for (let i = 0; i < 3; i++) fns.push((x) => x + i);
  return fns.map((f) => f(10)); // [10, 11, 12]
}

export function makeGreeter(greeting: string): (name: string) => string {
  return (name) => \`\${greeting}, \${name}!\`;
}`,
    },
    {
      kind: "p",
      text: "Functions can be passed to and returned from exported functions; how they behave when JavaScript calls them, or Lucent calls a JavaScript function, is described in [Callbacks](/docs/boundary/callbacks/).",
    },
    { kind: "h2", text: "Generators" },
    {
      kind: "p",
      text: "`function*` declarations, expressions and methods work with `yield`, `yield*` and `return;`. They are lazy, as in JavaScript, and leaving a `for…of` early runs the generator's `finally` blocks. `Iterable<T>` parameters accept generators, arrays, sets, maps, strings and `Uint8Array`.",
    },
    {
      kind: "code",
      filename: "ranges.lucent.ts",
      code: `function* range(from: number, to: number, step = 1): Generator<number> {
  for (let i = from; i < to; i += step) yield i;
}

function* take<T>(xs: Iterable<T>, n: number): Generator<T> {
  if (n <= 0) return;
  let i = 0;
  for (const x of xs) {
    yield x;
    if (++i >= n) return;
  }
}

export function evens(limit: number): number[] {
  return [...take(range(0, Infinity, 2), limit)];
}`,
    },
    {
      kind: "p",
      text: "Not supported: using the value of `yield` (`next(x)`), returning a value from a generator, and async generators. Generators cannot be returned to JavaScript; collect them into an array.",
    },
    { kind: "h2", text: "Regular expressions" },
    {
      kind: "p",
      text: "Regex literals and `new RegExp(pattern, flags)` support every ECMAScript feature and flag (`dgimsuvy`), including lookbehind, named groups and Unicode property escapes. `exec`, `test` and `lastIndex` work, as do the string methods `match`, `matchAll`, `search`, `replace`, `replaceAll` (with `$` patterns or a callback) and `split`.",
    },
    {
      kind: "code",
      filename: "patterns.lucent.ts",
      code: `export function yearOf(text: string): string | undefined {
  const m = /(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})/.exec(text);
  return m?.groups?.year;
}

export function doublePixels(css: string): string {
  return css.replace(/(\\d+)px/g, (_whole: string, n: string) => \`\${Number(n) * 2}px\`);
}`,
    },
    {
      kind: "p",
      text: "A replacement callback that takes capture parameters needs a literal pattern. Type a capture parameter `string | undefined` if its group may not participate; typed `string`, it throws a `TypeError` when the group is missing.",
    },
    { kind: "h2", text: "JSON" },
    {
      kind: "p",
      text: "`JSON.stringify` works on any Lucent value (no replacer or indent). `JSON.parse(text) as T`, or parsing into an annotated variable, builds a value of type `T` and checks the text against it: a mismatch throws a `TypeError` that names the path, such as `expected a number at .items[2].price, got a string`.",
    },
    {
      kind: "code",
      filename: "orders.lucent.ts",
      code: `type Item = { name: string; price: number; discount: number | null };
type Order = { id: number; items: Item[]; meta: Record<string, string> };

export function total(text: string): number {
  const order = JSON.parse(text) as Order;
  return order.items.reduce((sum, it) => sum + it.price * (1 - (it.discount ?? 0)), 0);
}`,
    },
    {
      kind: "p",
      text: "Target types must be plain data: numbers, strings, booleans, `null`, arrays, tuples, records, object types, and unions that JSON kinds or a string-literal discriminant can tell apart. Revivers are not supported.",
    },
];

import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/differences",
  title: "Differences from JavaScript",
  description: "The complete list of places where a Lucent module behaves differently from the same code in JavaScript, and why.",
  blocks: [
    {
      kind: "p",
      text: "Code that type-checks and stays in the subset behaves like JavaScript. Where native code cannot match JavaScript, Lucent throws instead of silently doing something else, and the difference is listed here. Features that are simply not supported give a compile-time diagnostic instead; they are covered on the other pages of this section.",
    },
    { kind: "h2", text: "Deviations" },
    {
      kind: "table",
      head: ["JavaScript", "Lucent"],
      rows: [
        ["`arr[i] = v` with `i > arr.length` creates holes", "throws `RangeError`; append with `push` or assign at `arr.length`"],
        ["`arr[i]` or `record[k]` out of range gives `undefined`", "same, and the type says `T | undefined`; `!` throws `TypeError` if the value is absent"],
        ["arrays and objects passed to native code are shared", "copied at the boundary; inside Lucent they are shared (see [Conversions](/docs/boundary/conversions/))"],
        ["`Date` objects passed to native code are shared", "copied at the boundary; inside Lucent they are shared"],
        ["garbage collection frees cycles", "reference counting leaks cycles (see below)"],
        ["deep recursion throws `RangeError`", "may overflow the native stack and crash (see below)"],
        ["`console.log(obj)` pretty-prints", "prints `String(obj)`, to os_log on iOS and logcat on Android"],
        ["`str.split(regexp)` inserts `undefined` for a capture group that did not participate", "inserts `\"\"`, so the result stays a `string[]`"],
        ["`JSON.parse` returns whatever the text contains", "the text must match the target type; a mismatch throws `TypeError` naming the path"],
        ["`JSON.stringify` of parsed data keeps the text's key order", "keys follow the declared type's order"],
        ["`date.toString()` includes a zone name in some engines", "`Mon Jul 22 2019 15:51:50 GMT-0700`, like Hermes; `toLocale…` methods are not supported"],
        ["`abort()` without a reason uses an engine-specific message", "`AbortError: signal is aborted without reason`, as in React Native and browsers"],
        ["an abort reason can be any value", "reasons from JavaScript become errors (`String(reason)` as the message when not an object); `abort()` in Lucent takes an `Error`"],
        ["a subclass field read from a base constructor is `undefined` until initialized", "it reads the type's default (`0`, `\"\"`, `false`, an empty object)"],
        ["any object with the right members satisfies an interface", "only classes that declare `implements`; plain JS objects are rejected at the boundary with a `TypeError`"],
      ],
    },
    { kind: "h2", text: "Memory" },
    {
      kind: "p",
      text: "Objects, arrays, closures and class instances are reference counted, and freed as soon as the last reference goes away. There is no garbage collector, so a **cycle of strong references is never freed**: a parent and child that point at each other, or a closure stored on the object it captures.",
    },
    {
      kind: "code",
      filename: "tree.lucent.ts",
      code: `export class TreeNode {
  children: TreeNode[] = [];
  parent: TreeNode | undefined = undefined;

  constructor(public label: string) {}

  add(child: TreeNode): TreeNode {
    child.parent = this; // child -> parent and parent -> child: a cycle
    this.children.push(child);
    return child;
  }

  dispose(): void {
    for (const c of this.children) c.dispose();
    this.children = [];
    this.parent = undefined; // break the cycle so both sides can be freed
  }
}`,
    },
    {
      kind: "p",
      text: "Break cycles explicitly when you are done with a structure, for example by clearing a field, or avoid them by storing ids and looking objects up in a `Map`. Class instances handed to JavaScript stay alive as long as either side holds them.",
    },
    { kind: "h2", text: "Recursion depth" },
    {
      kind: "p",
      text: "JavaScript engines throw a `RangeError` when recursion gets too deep. Lucent functions use the native stack, and very deep recursion can overflow it and crash the app. Recursion over data of bounded depth is fine; for input whose depth you do not control (deeply nested data, long linked lists), use a loop with an explicit stack.",
    },
    {
      kind: "code",
      filename: "depth.lucent.ts",
      code: `export type Nested = { value: number; children: Nested[] };

export function sum(root: Nested): number {
  let total = 0;
  const stack: Nested[] = [root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    total += n.value;
    stack.push(...n.children);
  }
  return total;
}`,
    },
    {
      kind: "p",
      text: "If you find another difference, it is a bug: Lucent's tests run each feature in both JavaScript and native code and compare the results.",
    },
  ],
};

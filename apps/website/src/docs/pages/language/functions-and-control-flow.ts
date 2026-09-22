import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/functions-and-control-flow",
  title: "Functions & control flow",
  description: "The statements and expressions Lucent compiles, and the ones it rejects on purpose.",
  blocks: [
    { kind: "h2", text: "Functions" },
    {
      kind: "p",
      text: "Annotate every parameter and the return type. Locals may be inferred. Recursion and calls to other local, imported or bound functions are fine. A function takes at most 8 parameters.",
    },
    {
      kind: "code",
      filename: "fibonacci.lucent.ts",
      code: "export function fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    {
      kind: "p",
      text: "A function value cannot be stored or passed into JavaScript (`NT1005`). Inside native code, a compiled function or a synchronous arrow can be a [`NativeCallback`](/docs/api/types/). An arrow may capture an immutable primitive or value record, an owned native reference, an explicit `weak(reference)`, or a borrow when the callback's contract says `retention: \"call\"`. Mutable locals, external resources, and subscription callbacks cannot be captured.",
    },
    { kind: "h2", text: "Statements" },
    {
      kind: "table",
      head: ["Supported", "Not in the subset"],
      rows: [
        ["`const`, `let`", "`var`"],
        ["`if` / `else`", "`switch`"],
        ["`while`, `for (;;)`", "`do … while`, `for … in`"],
        ["`for … of` over an array", "labels, `with`, `debugger`"],
        ["`return`, `break`, `continue`, `throw`", "`try` / `catch`"],
        ["expression statements, blocks", "function or class declarations inside functions"],
      ],
    },
    {
      kind: "note",
      text: "Assignments, `++`, `--` and `array.push(x)` are statements, not expressions. `continue` inside a C-style `for` loop is rejected because it would skip the update step; use `while`.",
    },
    { kind: "h2", text: "Expressions" },
    {
      kind: "table",
      head: ["Operation", "Syntax"],
      rows: [
        ["Arithmetic", "`+ - * / %`, unary `-`"],
        ["Comparison", "`< <= > >=`"],
        ["Equality", "`=== !==` only. `==` and `!=` are `NT1001`."],
        ["Logic", "`&& || !`"],
        ["Updates (statements)", "`+= -= *= /=`, `++`, `--`"],
        ["Records", "`value.field`; object literal where the target type is a known record"],
        ["Arrays", "`array.length`, `array[i]`, `array.push(x)`, array literals"],
        ["Maps", "`map[key]` yields `optional<T>`"],
        ["Strings", "template literals interpolating primitives; `length`"],
        ["Bytes", "`bytes.length`, `bytes[i]` → `number`"],
        ["Calls", "local, imported, bound functions; `await` inside `async`"],
        ["Objects", "`this`, `new Class(…)`, `new LucentError(…)`"],
        ["Literals", "numbers, strings, `true`, `false`, `null`, `undefined`, parentheses"],
      ],
    },
    {
      kind: "p",
      text: "Outside the subset, all `NT1001`: spread, destructuring, optional chaining, `typeof`, `in`, `instanceof`, construction of arbitrary objects, and dynamic property access `obj[key]` on a record (`NT1002`). Arrows are allowed only as native callbacks, described above.",
    },
    { kind: "h2", text: "What lowering does" },
    {
      kind: "p",
      text: "The checker's typed tree is lowered to an IR that has no JavaScript-only forms. This is why some constructs are statements only: they must map to a single native statement.",
    },
    {
      kind: "table",
      head: ["Source", "IR"],
      rows: [
        ["`let` / `const`, shadowing", "unique locals per function"],
        ["reassigned parameter", "a mutable local initialised from the parameter"],
        ["`for (init; test; update)`", "`init; while test { body; update }`"],
        ["`for (const x of xs)`", "`foreach x in xs`"],
        ["`a += b`, `i++`", "`assign a = (add a b)`"],
        ["`` `a${n}` ``, `s + t`", "`(concat …)`"],
        ["narrowed optional", "`(unwrap x)` inserted by the checker"],
        ["`throw new LucentError(c, { message })`", "`throw \"c\" message`"],
      ],
    },
  ],
};

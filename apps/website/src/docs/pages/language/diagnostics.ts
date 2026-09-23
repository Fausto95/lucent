import { diagnosticCodes } from "../../../generated/diagnostics";
import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/diagnostics",
  title: "Diagnostics",
  description:
    "Every `LUCENT` code the compiler reports, what it means, and how to fix the common ones.",
  blocks: [
    {
      kind: "p",
      text: "Code outside the subset fails the build with a diagnostic that points at the source. Nothing is written until every diagnostic is fixed. `lucent build`, `lucent check`, Metro and the [editor plugin](/docs/reference/core/) all report the same diagnostics.",
    },
    {
      kind: "code",
      filename: "terminal",
      code: "src/geo.lucent.ts:2:3: LUCENT1001: use `let` or `const` instead of `var`\n\n✗ 1 problem(s); nothing was written.",
    },
    {
      kind: "p",
      text: "Codes are stable. The first digit groups them: `1xxx` for syntax and built-ins, `2xxx` for types without a native representation, `3xxx` for module structure, and `9001` for TypeScript errors, because Lucent compiles only programs that type-check.",
    },
    { kind: "h2", text: "All codes" },
    {
      kind: "table",
      head: ["Code", "Meaning"],
      rows: diagnosticCodes.map(({ code, description }) => [`\`${code}\``, description]),
    },
    { kind: "h2", text: "Common fixes" },
    { kind: "h3", text: "Give every value a native type" },
    {
      kind: "p",
      text: "Native code needs to know each value's layout, so `any` and `unknown` are rejected (`unknown` is allowed only in `catch`). Use a concrete type, or a union.",
    },
    {
      kind: "code",
      filename: "parse.lucent.ts",
      expect: "LUCENT2001",
      code: "export function size(value: any): number {\n  return value.length;\n}",
    },
    { kind: "h3", text: "Tell union members apart" },
    {
      kind: "p",
      text: "Values that come from JavaScript carry no type, so Lucent must be able to tell which member of an object union it received. Add a string-literal field such as `kind`.",
    },
    {
      kind: "code",
      filename: "shapes.lucent.ts",
      expect: "LUCENT2005",
      code: "export function area(shape: { radius: number } | { side: number }): number {\n  return \"radius\" in shape ? Math.PI * shape.radius ** 2 : shape.side ** 2;\n}",
    },
    { kind: "h3", text: "Wrap generic exports" },
    {
      kind: "p",
      text: "Generic functions compile to C++ templates, which JavaScript cannot call without a concrete type. Export a concrete wrapper instead.",
    },
    {
      kind: "code",
      filename: "stack.lucent.ts",
      expect: "LUCENT2007",
      code: "export function last<T>(items: T[]): T | undefined {\n  return items[items.length - 1];\n}",
    },
    { kind: "h3", text: "Throw errors, not values" },
    {
      kind: "code",
      filename: "config.lucent.ts",
      expect: "LUCENT1006",
      code: 'export function port(text: string): number {\n  const n = Number(text);\n  if (!Number.isInteger(n)) throw "not a port";\n  return n;\n}',
    },
    {
      kind: "p",
      text: "Throw `new Error(…)`, `new TypeError(…)`, or a class that extends `Error`. See [Errors](/docs/language/errors/).",
    },
  ],
};

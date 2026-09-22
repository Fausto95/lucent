import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/unions",
  title: "Discriminated unions",
  description: "Model outcomes with records that share a string-literal tag. The compiler checks construction and narrows after a tag comparison.",
  blocks: [
    {
      kind: "code",
      filename: "result.lucent.ts",
      code: 'export type Result =\n  | { kind: "ok"; value: number }\n  | { kind: "error"; message: string };\n\nexport function read(result: Result): number {\n  if (result.kind === "ok") {\n    return result.value; // narrowed\n  }\n  return 0;\n}\n\nexport function parse(text: string): Result {\n  if (text.length === 0) {\n    return { kind: "error", message: "Empty" };\n  }\n  return { kind: "ok", value: text.length };\n}',
    },
    { kind: "h2", text: "Rules" },
    {
      kind: "list",
      items: [
        "Every variant has the same required string-literal discriminator, and tags are unique.",
        "Variants may be inline records or separately named record aliases.",
        "Narrow with `===` or `!==` on a local or parameter, including the early-return form. `switch` is not supported.",
        "A payload field shared by several variants must have the same type in each.",
        "Union values are immutable. Replace the whole value to change variant.",
        "Unions other than tagged records and `T | null` / `T | undefined` are `LC1003`.",
      ],
    },
    { kind: "h2", text: "Native representation" },
    {
      kind: "p",
      text: "Natively a union is one tagged record with a nullable slot per payload field. The generated proxy validates the tag and required payload on the way in, pads inactive slots, and removes them on the way out. The app's `.d.ts` keeps the TypeScript union unchanged.",
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { parse } from "./src/result.lucent";\n\nparse("abc"); // { kind: "ok", value: 3 }\nparse(""); // { kind: "error", message: "Empty" }',
    },
  ],
};

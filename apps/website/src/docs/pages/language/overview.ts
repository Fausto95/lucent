import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language",
  title: "The language",
  description:
    "A constrained subset of TypeScript. Everything TypeScript allows but Lucent does not is rejected with a dedicated `LUCENT` diagnostic, never with a generic TypeScript error.",
  blocks: [
    { kind: "h2", text: "Module shape" },
    {
      kind: "p",
      text: "A module is one `*.lucent.ts` file (functions, types, classes, events) or one `*.lucent.tsx` file (native views). Nothing in it runs in a JavaScript engine.",
    },
    {
      kind: "list",
      items: [
        "`export function` and `export async function` are the module's native API. Non-exported functions are private helpers.",
        "`type Name = { … }` declares a value record. It may be exported or not, and needs at least one field.",
        "`export class` declares a [native class](/docs/language/native-classes/); `export const name = event<T>()` declares an [event](/docs/language/events/).",
        "Named imports, with or without alias, refer to other Lucent files (`./math.lucent` or `./math.lucent.ts`), to the `@lucent-lang/*` packages, or to libraries registered in `lucent.config.ts`. Type-only imports cannot be used as values.",
        "No default or namespace imports, no re-exports, no JavaScript packages, no top-level statements that execute.",
      ],
    },
    {
      kind: "code",
      filename: "shape.lucent.ts",
      code: 'import type { int32 } from "@lucent-lang/types";\nimport { square } from "./math.lucent";\n\ntype Pair = { a: int32; b: int32 };\n\nfunction helper(pair: Pair): int32 {\n  return pair.a + pair.b;\n}\n\nexport function sumOfSquares(pair: Pair): number {\n  return square(helper(pair));\n}',
    },
    { kind: "h2", text: "Types" },
    {
      kind: "p",
      text: "Every supported type has one native representation on each platform. Parameters and return types must be annotated; locals may be inferred from their initializer.",
    },
    {
      kind: "table",
      head: ["TypeScript", "Native type", "Swift", "Kotlin"],
      rows: [
        ["`number`", "`float64`", "`Double`", "`Double`"],
        ["`string`", "`string`", "`String`", "`String`"],
        ["`boolean`", "`bool`", "`Bool`", "`Boolean`"],
        ["`void`", "`void`", "`Void`", "`Unit`"],
        ["`T[]`, `Array<T>`", "`array<T>`", "`[T]`", "`List<T>`"],
        ["`T | null`, `T | undefined`, `field?: T`", "`optional<T>`", "`T?`", "`T?`"],
        ["`Record<string, T>`", "`map<T>`", "`[String: T]`", "`Map<String, T>`"],
        ["`Uint8Array`", "`bytes`", "`ArrayBuffer`", "`ArrayBuffer`"],
        ["`Promise<T>` (async return only)", "`promise<T>`", "`async … -> T`", "`suspend …: T`"],
        ["object type alias", "`struct`", "`struct`", "`data class`"],
        ["tagged union of records", "tagged record", "`struct` + tag", "`data class` + tag"],
        ["`int8…int64`, `uint8…uint64`, `float32`, `float64`", "sized numerics", "`Int32`, `Float`, …", "`Int`, `Float`, …"],
        ["`class`", "reference object", "`final class`", "`class`"],
      ],
    },
    {
      kind: "list",
      items: [
        "Sized numerics come from `@lucent-lang/types`. At the JS boundary they are plain `number`s; the brand only picks the native representation.",
        "Numeric types never convert implicitly: `int32 + number` is `LUCENT1011`. Integer literals adopt the sized type of their context.",
        "A record's fields may be any type above except `Promise`. Records are copied across the boundary.",
        "Optionals must be narrowed before use with `=== null`, `!== null`, `=== undefined` or `!== undefined` on a local or parameter. The early-return form counts.",
        "There is no truthiness. `if (x)` is `LUCENT1011` unless `x` is a boolean.",
        "`any` and `unknown` are `LUCENT1004`. A function type crosses only as a `NativeCallback` inside native code (`LUCENT1005` otherwise). `never`, `object`, `symbol`, `bigint`, tuples, generics, interfaces and enums are `LUCENT1003`. There is no `Date`.",
      ],
    },
    {
      kind: "code",
      filename: "optionals.lucent.ts",
      code: "export type User = { id: string; nickname?: string };\n\nexport function display(user: User): string {\n  const nickname = user.nickname;\n  if (nickname === undefined) {\n    return user.id;\n  }\n  return nickname; // narrowed to string\n}",
    },
    { kind: "h2", text: "Semantics" },
    {
      kind: "table",
      head: ["Topic", "Behaviour"],
      rows: [
        ["Numbers", "`number` is an IEEE 754 double. `/` is floating division; `%` follows JavaScript. `+` on strings concatenates."],
        ["Sized integers", "Wrap on overflow, as on the target platform."],
        ["Arrays", "Copied across the JS boundary; reference-shared inside native code like Swift `Array` / Kotlin `List` in the generated code."],
        ["Bytes", "`Uint8Array` crosses as an `ArrayBuffer`. Sync functions may read it in place; async functions get a copy. Indexing yields a `number`."],
        ["Errors", "A thrown `LucentError` reaches JavaScript with `code`, `message` and scalar `metadata`, identically on Expo and Nitro."],
        ["Parameters", "At most 8 per function (`LUCENT1007`)."],
      ],
    },
    { kind: "h2", text: "Pages in this section" },
    {
      kind: "cards",
      items: [
        { title: "Functions & control flow", text: "Statements, expressions, and what is outside the subset.", href: "/docs/language/functions-and-control-flow/" },
        { title: "Async & errors", text: "`Promise<T>`, `await`, and `LucentError`.", href: "/docs/language/async-and-errors/" },
        { title: "Discriminated unions", text: "Tagged records with checked narrowing.", href: "/docs/language/unions/" },
        { title: "Native classes", text: "Reference objects with native state and JS handles.", href: "/docs/language/native-classes/" },
        { title: "Events", text: "Typed channels from native code to the app.", href: "/docs/language/events/" },
        { title: "Native views", text: "TSX rendered by SwiftUI and Compose.", href: "/docs/language/native-views/" },
        { title: "Threads", text: "`@MainThread`, `@Background`, and main-thread cost warnings.", href: "/docs/language/threads/" },
        { title: "Platform & capabilities", text: "Guards, the built-in library, config, and SDK bindings.", href: "/docs/language/platform-and-capabilities/" },
        { title: "Diagnostics", text: "Every `LUCENT` code and what to do about it.", href: "/docs/language/diagnostics/" },
      ],
    },
  ],
};

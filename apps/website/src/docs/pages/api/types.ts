import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/types",
  title: "@lucent-lang/types",
  description: "Sized numeric types, the `NativeCallback` marker, and the global `LucentError` declaration.",
  blocks: [
    { kind: "h2", text: "Sized numerics" },
    {
      kind: "code",
      filename: "import",
      code: 'import type { int8, int16, int32, int64, uint8, uint16, uint32, uint64, float32, float64 } from "@lucent-lang/types";',
    },
    {
      kind: "p",
      text: "Each is `number` with a brand. At the JavaScript boundary every one of them is a plain `number`; the brand only tells the compiler which native representation to use. `number` itself is `float64`.",
    },
    {
      kind: "table",
      head: ["Type", "Swift", "Kotlin"],
      rows: [
        ["`int8`, `int16`, `int32`, `int64`", "`Int8`, `Int16`, `Int32`, `Int64`", "`Byte`, `Short`, `Int`, `Long`"],
        ["`uint8`, `uint16`, `uint32`, `uint64`", "`UInt8`, `UInt16`, `UInt32`, `UInt64`", "`UByte`, `UShort`, `UInt`, `ULong`"],
        ["`float32`", "`Float`", "`Float`"],
        ["`float64`, `number`", "`Double`", "`Double`"],
      ],
    },
    {
      kind: "list",
      items: [
        "No implicit conversion between numeric types (`NT1011`).",
        "Integer literals adopt the sized type of their context: `const n: int32 = 1`.",
        "Arithmetic on sized integers wraps on overflow.",
      ],
    },
    { kind: "h2", text: "NativeCallback" },
    {
      kind: "code",
      filename: "signature",
      code: "export type NativeCallback<F extends (...args: never[]) => unknown> = F;",
    },
    {
      kind: "p",
      text: "Marks a parameter as a synchronous native function reference. A compiled Lucent function can be passed where a `NativeCallback` is expected, and a library binding can receive one. Swift callbacks are escaping and may throw; Kotlin callbacks are function types.",
    },
    {
      kind: "code",
      filename: "callback.lucent.ts",
      code: 'import type { NativeCallback } from "@lucent-lang/types";\n\nfunction twice(value: number): number {\n  return value * 2;\n}\n\nfunction apply(value: number, callback: NativeCallback<(value: number) => number>): number {\n  return callback(value);\n}\n\nexport function result(): number {\n  return apply(4, twice); // 8\n}',
    },
    {
      kind: "list",
      items: [
        "Callbacks never cross into JavaScript (`NT1005`). Use an [event](/docs/api/events/) to notify the app.",
        "Async function references and capturing arrow functions are rejected.",
        "A binding marked `nativeOnly: true` in a [manifest](/docs/api/library-manifest/) may take callbacks and is omitted from the generated JavaScript API.",
      ],
    },
    { kind: "h2", text: "LucentError (global)" },
    {
      kind: "code",
      filename: "declaration",
      code: "declare global {\n  class LucentError extends Error {\n    constructor(\n      code: string,\n      options?: { message?: string; metadata?: Record<string, string | number | boolean | null> },\n    );\n    readonly code: string;\n    readonly metadata: Readonly<Record<string, string | number | boolean | null>>;\n  }\n}",
    },
    {
      kind: "p",
      text: "The only throwable in Lucent source. Declared globally by this package so no import is needed. See [async & errors](/docs/language/async-and-errors/) and the [runtime](/docs/api/runtime/) that reconstructs it in the app.",
    },
  ],
};

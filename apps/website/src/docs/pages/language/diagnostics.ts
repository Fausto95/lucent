import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/diagnostics",
  title: "Diagnostics",
  description: "Every rejection has an `LUCENT` code, a message, a code frame, and usually a hint. Nothing outside the subset reaches native code.",
  blocks: [
    {
      kind: "code",
      filename: "terminal",
      code: "npx lucent check\n\nsrc/geo.lucent.ts:4:14 LUCENT1014 Missing type annotation\n  4 | export function scale(value) {\n    |                       ^^^^^\n  help: parameters and return types must be annotated",
    },
    {
      kind: "p",
      text: "`lucent check` reports without generating. `lucent build`, the Expo plugin and Metro report the same diagnostics; errors fail the build, warnings do not.",
    },
    { kind: "h2", text: "Language" },
    {
      kind: "table",
      head: ["Code", "Meaning", "Typical fix"],
      rows: [
        ["`LUCENT1000`", "Syntax error from the parser", "Also raised for `await` outside `async`."],
        ["`LUCENT1001`", "Unsupported syntax", "Spread, `switch`, `try`, `==`, async arrows, non-`LucentError` throws… Rewrite with the [supported forms](/docs/language/functions-and-control-flow/)."],
        ["`LUCENT1002`", "Dynamic property access", "`obj[key]` on a record. Use `obj.field`, or a `Record<string, T>`."],
        ["`LUCENT1003`", "Unsupported type", "Tuples, generics, interfaces, enums, `never`, `object`, `symbol`, `bigint`, untagged unions."],
        ["`LUCENT1004`", "`any` / `unknown` is prohibited", "Give the value a concrete type."],
        ["`LUCENT1005`", "Function value cannot cross the native boundary", "Use an [event](/docs/language/events/) for JS callbacks, `NativeCallback` for native-to-native."],
        ["`LUCENT1006`", "Unsupported dependency", "Only Lucent files, `@lucent-lang/*` and registered libraries can be imported. Check the path, the export, and cycles."],
        ["`LUCENT1007`", "Too many parameters", "Group arguments into a record."],
        ["`LUCENT1010`", "Unknown identifier", ""],
        ["`LUCENT1011`", "Type mismatch", "Includes `int32 + number` and non-boolean conditions."],
        ["`LUCENT1012`", "Wrong number of arguments", ""],
        ["`LUCENT1013`", "`await` outside an async function", ""],
        ["`LUCENT1014`", "Missing type annotation", "Annotate parameters and return types."],
        ["`LUCENT1015`", "Missing return", "Every path must return when the return type is not `void`."],
        ["`LUCENT1016`", "Assignment to a constant", "Use `let`."],
        ["`LUCENT1018`", "Borrowed value escapes its scope", "Do not return, store, or use a borrow after `await` or `close`."],
        ["`LUCENT1019`", "Native call is on the wrong executor", "Match `@MainThread`, `@Background`, or keep a serial object on the caller."],
      ],
    },
    { kind: "h2", text: "Platform" },
    {
      kind: "table",
      head: ["Code", "Meaning", "Typical fix"],
      rows: [
        ["`LUCENT2001`", "Missing native capability", "Add the capability to `lucent.config.ts`."],
        ["`LUCENT2004`", "Platform-specific API", "Wrap the call in a `Platform.OS` guard."],
      ],
    },
    { kind: "h2", text: "Warnings" },
    {
      kind: "table",
      head: ["Code", "Meaning", "Typical fix"],
      rows: [
        ["`LUCENT3002`", "Potentially expensive main-thread work", "Move loops, recursion or `cost`-marked bindings behind a `@Background` hop. See [threads](/docs/language/threads/)."],
      ],
    },
    {
      kind: "p",
      text: "Configuration and manifest problems (unknown capability, invalid library metadata, two config files) fail the build with a plain error rather than an `LUCENT` code, since they are not attached to a source position.",
    },
  ],
};

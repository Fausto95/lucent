import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["Built-in", "What's there", "Not there, or different"],
    rows: [
      ["`Math`", "Every function and constant.", ""],
      [
        "`Number`",
        "`isInteger`, `isSafeInteger`, `isFinite`, `isNaN`, `parseInt`, `parseFloat`, the constants; `toString(radix)`, `toFixed`, `toPrecision`, `toExponential`.",
        "",
      ],
      [
        "Globals",
        "`parseInt`, `parseFloat`, `isNaN`, `isFinite`, `String()`, `Number()`, `Boolean()`.",
        "",
      ],
      [
        "`String`",
        "The instance methods, `String.fromCharCode`, `String.fromCodePoint`. Case mapping uses Unicode's full rules; `localeCompare` uses the platform's collator.",
        "No `Intl`.",
      ],
      [
        "`Array`",
        "The instance methods, including `find`, `findIndex`, `flatMap`, `at`; `Array.from`, `Array.of`, `Array.isArray`, `new Array(n)`.",
        "Not the ES2023 methods: `toSorted`, `toReversed`, `findLast`, `findLastIndex`. Writing past the end throws a `RangeError`.",
      ],
      ["`Map`, `Set`", "The whole API; `new Map(entries)`, `new Set(iterable)`.", ""],
      [
        "`Object`",
        "`keys`, `values`, `entries`, `fromEntries`.",
        "On records; `keys` also on object types.",
      ],
      [
        "`JSON`",
        "`JSON.stringify` of any value; `JSON.parse(text) as T`.",
        "No replacer, indent or reviver. `parse` checks the text against `T`.",
      ],
      [
        "`RegExp`",
        "Every feature and flag (`dgimsuvy`); `exec`, `test`, `match`, `matchAll`, `search`, `replace`, `replaceAll`, `split`.",
        "A replacer with capture parameters needs a literal pattern.",
      ],
      [
        "`Date`",
        "Constructors, `Date.now`, `Date.parse`, `Date.UTC`, the getters and setters, `toISOString`, `toString` and the other string forms.",
        "No `toLocale…` methods. `toString` has Hermes's format.",
      ],
      [
        "`Uint8Array`",
        "`length`, `byteLength`, `subarray`, `slice`, `fill`, `indexOf`, `includes`, `set`, `forEach`, `map`, `reduce`, `join`.",
        "`reduce` needs an initial value.",
      ],
      [
        "`Promise`",
        "`Promise.all`, `Promise.resolve`, `Promise.reject`, `new Promise`.",
        "No `race`, `allSettled`, `any` or `.then`.",
      ],
      [
        "`console`",
        "`log`, `info`, `debug`, `warn`, `error`: to the unified log on iOS, logcat on Android (tag `Lucent`).",
        "Arguments print as `String(value)`.",
      ],
      [
        "`AbortController`, `AbortSignal`",
        '`signal`, `abort(error?)`; `aborted`, `throwIfAborted()`, `addEventListener("abort", …)`.',
        "No `signal.reason`.",
      ],
    ],
  },
  {
    kind: "p",
    text: "Not available: `Intl`, `Symbol`, `WeakMap`, `WeakRef`, `Proxy`, `eval`, `TextEncoder` and `TextDecoder`. Each is a compile error; for text, use `utf8Encode` and `utf8Decode` from [`lucent:core`](/docs/reference/modules/#lucent-core).",
  },
];

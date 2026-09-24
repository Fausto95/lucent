import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Lucent compiles every value to a native type known at build time. The rules below follow from that, and each break is a compile error with a `LUCENT` code.",
  },
  {
    kind: "table",
    head: ["In JavaScript", "In Lucent", "Why"],
    rows: [
      [
        "`any`",
        "a concrete type, a union or a generic (`LUCENT2001`)",
        "Native code needs each value's layout.",
      ],
      [
        "`obj[key]` on an object type",
        "a `Record<string, T>` or a `Map` (`LUCENT1001`)",
        "An object type is a C++ struct with fixed fields.",
      ],
      [
        "an object literal with methods or getters",
        "a class (`LUCENT2002`, `LUCENT1001`)",
        "Methods live on classes.",
      ],
      ["`var`", "`let` or `const` (`LUCENT1001`)", "One scoping rule."],
      [
        "`eval`, `new Function`",
        "not available (`LUCENT1003`)",
        "No JavaScript engine runs in native code.",
      ],
      [
        "`JSON.parse(text)`",
        "`JSON.parse(text) as Settings`",
        "The result is checked against the type, and a mismatch throws.",
      ],
      [
        '`throw "oops"`',
        '`throw error("E_OOPS", "Oops")` (`LUCENT1006`)',
        "Only `Error` values cross the boundary with a message and a code.",
      ],
      ["`Promise.race`, `.then`", "`await`, `Promise.all` (`LUCENT1003`)", "Not implemented yet."],
      ["`xs.toSorted()`", "`[...xs].sort()`", "The ES2023 methods aren't available yet."],
    ],
  },
  {
    kind: "code",
    filename: "settings.lucent.ts",
    code: `export type Settings = { theme: string; size: number };

export function parseSettings(text: string): Settings {
  return JSON.parse(text) as Settings; // throws a TypeError naming the bad field
}`,
  },
  { kind: "h2", text: "Numbers are exactly JavaScript's" },
  {
    kind: "p",
    text: "A `number` is a 64-bit float with JavaScript's arithmetic, rounding and formatting: `0.1 + 0.2` is `0.30000000000000004`, as in JavaScript. Locals that only hold integers are stored as integers, with the same results.",
  },
  {
    kind: "p",
    text: "Where Lucent does behave differently from JavaScript, [the list of differences](/docs/reference/language/#differences-from-javascript) has each case and its reason.",
  },
];

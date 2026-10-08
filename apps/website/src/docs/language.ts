/**
 * The language's subset tables and its differences from JavaScript, as the
 * API › Language pages show them (templates/api/language.ts and
 * templates/api/language/differences.ts). scripts/website/language.ts
 * checks them against the compiler, so a page can't drift from it:
 *   - each `refused` sample fails to compile with the code it names, and
 *     each `accepted` sample compiles;
 *   - each code is one of packages/compiler/src/codes.ts;
 *   - each case is in packages/compiler/test/e2e/cases/;
 *   - each known gap names at least one case: the behavior around the gap
 *     runs natively and as JavaScript, and a fix changes its output.
 * No imports: Node loads this file in the checks, and Vite in the templates.
 */

/** Sources by file name, compiled together as one app; a single string is `example.lucent.ts`. */
export type Sample = string | Record<string, string>;

/** Code that fails to compile with `code`. */
export interface Refusal {
  code: string;
  sample: Sample;
}

export interface Feature {
  feature: string;
  /** What Lucent does with it, in the docs' inline markup. */
  status: string;
  /** The page with the rules. */
  page: { title: string; href: string };
  cases?: string[];
  refused?: Refusal[];
  accepted?: Sample[];
}

export interface LeftOut {
  feature: string;
  why: string;
  instead: string;
  refused: Refusal[];
}

/** A row of Differences: what JavaScript does, what Lucent does, and why. */
export interface Difference {
  js: string;
  lucent: string;
  why: string;
  /** e2e cases that test the behavior around it; a known gap needs one. */
  cases: string[];
  refused?: Refusal[];
}

const MODULES = { title: "Modules", href: "/docs/api/language/modules/" };
const PLATFORM = { title: "Platform code", href: "/docs/api/language/platform-code/" };
const TYPES = { title: "Types", href: "/docs/api/language/types/" };
const STATEMENTS = { title: "Statements", href: "/docs/api/language/statements/" };
const BUILT_INS = { title: "Built-ins", href: "/docs/api/language/built-ins/" };
const BOUNDARY = { title: "Boundary", href: "/docs/api/language/boundary/" };
const CONCURRENCY = { title: "Concurrency", href: "/docs/api/language/concurrency/" };
const MEMORY = { title: "Memory", href: "/docs/api/language/memory/" };
const VIEWS = { title: "Views", href: "/docs/guides/views/" };
const DIFFERENCES = { title: "Differences", href: "/docs/api/language/differences/" };

const shapes = `export function area(w: number, h: number): number {
  return w * h;
}`;

/** Why a subset: what a native layout fixed at build time leaves out. */
export const leftOut: LeftOut[] = [
  {
    feature: "`any`, and `unknown` outside `catch`",
    why: "A value without a type has no layout.",
    instead: "A concrete type, a union or a generic.",
    refused: [
      { code: "LUCENT2001", sample: "export function size(x: any): number {\n  return 1;\n}" },
    ],
  },
  {
    feature: "`obj[key]` and `delete` on an object type",
    why: "An object type is a fixed set of fields.",
    instead: "A `Record<string, T>` or a `Map`.",
    refused: [
      {
        code: "LUCENT1001",
        sample:
          'type O = { a: number; b: number };\nexport function read(o: O, k: "a" | "b"): number {\n  return o[k];\n}',
      },
      {
        code: "LUCENT1002",
        sample: "type O = { a?: number };\nexport function clear(o: O): void {\n  delete o.a;\n}",
      },
    ],
  },
  {
    feature: "`eval`, `new Function`",
    why: "There is no engine to run the text.",
    instead: "Code in the module.",
    refused: [
      { code: "LUCENT1003", sample: 'export function run(): number {\n  return eval("1");\n}' },
      {
        code: "LUCENT2002",
        sample: 'export function make(): void {\n  new Function("return 1");\n}',
      },
    ],
  },
  {
    feature: "`var`",
    why: "Function scoping and hoisting.",
    instead: "`let` or `const`.",
    refused: [
      {
        code: "LUCENT1001",
        sample: "export function one(): number {\n  var x = 1;\n  return x;\n}",
      },
    ],
  },
];

/** At a glance: every part of the language, what Lucent does with it, and the page with its rules. */
export const features: Feature[] = [
  {
    feature: "Top-level declarations, imports and exports",
    status: "Yes. The top level holds declarations only (`LUCENT3002` otherwise).",
    page: MODULES,
    cases: ["modules", "module-initialization"],
    refused: [
      {
        code: "LUCENT3002",
        sample: 'const cache = new Map<string, number>();\ncache.set("a", 1);',
      },
    ],
  },
  {
    feature: "Imports of other modules, `lucent:*` modules and Lucent packages' modules",
    status:
      "Yes, by name or as a namespace: `import * as shapes` reads the module's exports, but isn't a value itself.",
    page: MODULES,
    cases: ["modules"],
    accepted: [
      {
        "shapes.lucent.ts": shapes,
        "room.lucent.ts":
          'import * as shapes from "./shapes.lucent";\n\nexport function floor(): number {\n  return shapes.area(3, 4);\n}',
      },
    ],
    refused: [
      {
        code: "LUCENT1001",
        sample: {
          "shapes.lucent.ts": shapes,
          "room.lucent.ts":
            'import * as shapes from "./shapes.lucent";\n\nexport function all(): number {\n  const ns = shapes;\n  return 1;\n}',
        },
      },
    ],
  },
  {
    feature: "Imports of npm packages and plain `.ts` files",
    status: "Types only, with `import type`. A value import fails with `LUCENT3001`.",
    page: MODULES,
  },
  {
    feature: "Export lists, re-exports and `export default`",
    status: "No (`LUCENT3003`). Put `export` on each declaration.",
    page: MODULES,
    refused: [
      { code: "LUCENT3003", sample: "export default function f(): number {\n  return 1;\n}" },
      { code: "LUCENT3003", sample: "export default class Store {}" },
      { code: "LUCENT3003", sample: "function f(): number {\n  return 1;\n}\nexport { f };" },
    ],
  },
  {
    feature: "Exported variables",
    status:
      "An exported `let` is a live binding: JavaScript reads the value it holds now. An object it holds reaches JavaScript as a copy.",
    page: MODULES,
    cases: ["exported-variables"],
    accepted: ["export let count = 0;\n\nexport function bump(): void {\n  count++;\n}"],
  },
  {
    feature: "Module state, and what a JavaScript reload does to it",
    status: "Initialized in source order, and again on each reload.",
    page: MODULES,
    cases: ["module-initialization"],
  },
  {
    feature: 'Platform branches (`PLATFORM === "ios"`) and platform files',
    status: "Yes.",
    page: PLATFORM,
  },
  {
    feature: "`number`, `bigint`, `string`, `boolean`, `null`, `undefined`",
    status: "Yes, computed exactly as JavaScript computes them.",
    page: TYPES,
    cases: ["numbers", "bigint-arith", "strings"],
  },
  {
    feature:
      "Object types, arrays, tuples, records, `Map`, `Set`, `Uint8Array`, `ArrayBuffer`, `Date`, `RegExp`",
    status: "Yes.",
    page: TYPES,
    cases: ["collections", "array-buffers", "dates", "regexps"],
  },
  {
    feature: "Classes, interfaces, enums, unions and generics",
    status: "Yes. Interfaces with methods, or that a class implements, are nominal.",
    page: TYPES,
    cases: ["classes", "interfaces", "generics", "union-discriminants"],
  },
  {
    feature: "Native 64-bit integers from the SDKs",
    status: "`bigint`s.",
    page: TYPES,
    cases: ["bigint-values"],
  },
  {
    feature: "`any`, intersections, `symbol`, `object`",
    status: "No (`LUCENT2001`, `LUCENT2002`).",
    page: TYPES,
    refused: [
      {
        code: "LUCENT2002",
        sample:
          "type Both = { a: number } & { b: number };\nexport function first(x: Both): number {\n  return x.a;\n}",
      },
    ],
  },
  {
    feature: "Control flow, destructuring and operators",
    status:
      "Yes, with limits: `delete` and `in` on records only, `instanceof` on some types, no object rest, and loose `==` only where JavaScript doesn't convert.",
    page: STATEMENTS,
    cases: ["control-flow", "control", "mixed-equality"],
    refused: [
      {
        code: "LUCENT1004",
        sample:
          "type P = { a: number; b: number };\nexport function first(p: P): number {\n  const { a, ...rest } = p;\n  return a;\n}",
      },
      {
        code: "LUCENT1002",
        sample:
          "export function same(a: number | string, b: number): boolean {\n  return a == b;\n}",
      },
    ],
  },
  {
    feature: "Functions, closures, rest parameters, `async`/`await` and generators",
    status:
      "Yes. A function type can't have a rest parameter, and async generators fail (`LUCENT2002`).",
    page: STATEMENTS,
    cases: ["closures", "rest-parameters", "async", "generators"],
    accepted: [
      "export function sum(...xs: number[]): number {\n  let total = 0;\n  for (const x of xs) total += x;\n  return total;\n}",
    ],
    refused: [
      {
        code: "LUCENT2002",
        sample: "export async function* ticks(): AsyncGenerator<number> {\n  yield 1;\n}",
      },
    ],
  },
  {
    feature: "Regular expressions, and `JSON.parse` into a type",
    status: "Yes.",
    page: STATEMENTS,
    cases: ["regexps", "json"],
  },
  {
    feature: "`using` declarations",
    status: "Yes.",
    page: STATEMENTS,
    cases: ["using"],
  },
  {
    feature: "`var`, `eval`, tagged templates",
    status: "No.",
    page: STATEMENTS,
    refused: [
      {
        code: "LUCENT1001",
        sample:
          'function tag(s: TemplateStringsArray): string {\n  return s[0] ?? "";\n}\nexport function f(): string {\n  return tag`x`;\n}',
      },
    ],
  },
  {
    feature: "Decorators",
    status: "No (`LUCENT1005`).",
    page: STATEMENTS,
    refused: [
      {
        code: "LUCENT1005",
        sample: "function sealed(target: typeof Store): void {}\n\n@sealed\nexport class Store {}",
      },
    ],
  },
  {
    feature: "`Math`, `String`, `Array`, `Map`, `Date` and the other built-ins",
    status:
      "Most members, as JavaScript defines them. `Proxy`, `Reflect`, `Intl`, `WeakMap`, `normalize` and locale arguments are refused.",
    page: BUILT_INS,
    cases: ["strings", "collections", "numbers", "dates"],
    refused: [
      {
        code: "LUCENT1003",
        sample:
          "class Box {\n  v = 1;\n}\nexport function wrap(): Box {\n  return new Proxy(new Box(), {});\n}",
      },
      {
        code: "LUCENT1003",
        sample: 'export function nfc(s: string): string {\n  return s.normalize("NFC");\n}',
      },
    ],
  },
  {
    feature: "Values passed to and from JavaScript",
    status: "Copied or shared, by type.",
    page: BOUNDARY,
    cases: ["reference-identity", "null-or-undefined"],
  },
  {
    feature: "Threads, the Lucent lock and `compute`",
    status: "Module code runs one turn at a time, and `compute` tasks run in parallel.",
    page: CONCURRENCY,
    cases: ["compute"],
  },
  {
    feature: "Reference counting, `using` and native buffers",
    status: "No garbage collector.",
    page: MEMORY,
    cases: ["buffers", "using"],
  },
  {
    feature: "Components: exported `.lucent.tsx` functions that return a view",
    status: "Experimental.",
    page: VIEWS,
  },
  {
    feature: "Behavior that differs from JavaScript",
    status: "Listed with its reason.",
    page: DIFFERENCES,
  },
];

/** Deliberate differences, by section of the Differences page. */
export const differences: { title: string; rows: Difference[] }[] = [
  {
    title: "Arrays and collections",
    rows: [
      {
        js: "`arr[i] = v` past the end leaves holes.",
        lucent:
          "Throws a `RangeError`, whatever the element type. Append with `push`, or assign at `length`.",
        why: "A Lucent array has no holes: each element holds a value of its type.",
        cases: ["assignment-order"],
      },
      {
        js: "`arr[-1] = v` and `arr[1.5] = v` add a property.",
        lucent: "Throws a `RangeError`.",
        why: "A Lucent array has elements only, no other properties.",
        cases: [],
      },
      {
        js: "Setting a larger `length` leaves holes.",
        lucent: "Throws a `RangeError`, whatever the element type.",
        why: "A Lucent array has no holes.",
        cases: ["collections"],
      },
      {
        js: "`new Array(n)` has `n` holes.",
        lucent:
          "Refused unless a `.fill(v)` follows it ([LUCENT1003](/docs/api/diagnostics/#lucent1003)). Write `new Array(n).fill(v)` or `Array.from({ length: n }, (_, i) => …)`.",
        why: "A Lucent array has no holes, and its element type may have no `undefined`.",
        cases: ["collections"],
        refused: [
          {
            code: "LUCENT1003",
            sample:
              "export function zeros(n: number): number[] {\n  return new Array<number>(n);\n}",
          },
        ],
      },
      {
        js: "`x!` does nothing at run time.",
        lucent:
          "Throws a `TypeError` when `x` is `undefined` or `null`, such as an index out of range.",
        why: "The assertion is checked, so a wrong one fails where it's made.",
        cases: [],
      },
      {
        js: "`map.keys()`, `values()` and `entries()`, and the same methods of arrays and sets, return iterators.",
        lucent: "They return arrays, holding the contents at the time of the call.",
        why: "An array serves everywhere these iterators are read: `for…of`, spread and `Array.from`.",
        cases: ["collections"],
      },
      {
        js: "Garbage collection frees cycles.",
        lucent:
          "Reference counting never frees a cycle. Break it by clearing a field ([Memory](/docs/api/language/memory/#cycles-leak)).",
        why: "Lucent counts references, and no collector runs.",
        cases: [],
      },
      {
        js: "Deep recursion throws a `RangeError`.",
        lucent: "Deep recursion may overflow the native stack, which crashes the app.",
        why: "Lucent code runs on the native stack, with no depth check.",
        cases: [],
      },
    ],
  },
  {
    title: "Objects",
    rows: [
      {
        js: "An object's keys come in the order they were added.",
        lucent:
          "An object type's fields have one fixed order, which `JSON.stringify` and the objects JavaScript receives follow. Use a record where order matters.",
        why: "Objects of one type share one native layout.",
        cases: ["object-spread", "json"],
      },
      {
        js: '`Object.keys(obj)`, `for…in` and `"key" in obj` see the properties an object has.',
        lucent:
          "On an object type they're refused ([LUCENT1003](/docs/api/diagnostics/#lucent1003), `LUCENT1009`, `LUCENT1002`). They work on records.",
        why: "An object's native layout records neither which optional fields are set nor their order.",
        cases: ["object-keys"],
        refused: [
          {
            code: "LUCENT1003",
            sample:
              "type O = { a: number; b?: string };\nexport function keys(o: O): string[] {\n  return Object.keys(o);\n}",
          },
        ],
      },
      {
        js: "`{ b: undefined }` has a key `b`.",
        lucent:
          "An optional field holding `undefined` is unset: `JSON.stringify` and the boundary leave it out, and spreading skips it.",
        why: "A native field is set or unset, with no third state.",
        cases: ["object-spread", "absent-results"],
      },
    ],
  },
  {
    title: "Comparisons",
    rows: [
      {
        js: '`==` converts a number, string, boolean, bigint or object first, so `1 == "1"`.',
        lucent:
          "Refused ([LUCENT1002](/docs/api/diagnostics/#lucent1002)). Compare with `===` after converting.",
        why: "Lucent compiles `==` only where no conversion is needed: between values of one kind, or with `null` or `undefined` on one side.",
        cases: ["mixed-equality"],
      },
      {
        js: "Functions compare by reference.",
        lucent:
          "Comparing functions is refused, by `===`, `indexOf` or `includes` ([LUCENT1002](/docs/api/diagnostics/#lucent1002)), or as `Map` keys and `Set` elements ([LUCENT2002](/docs/api/diagnostics/#lucent2002)).",
        why: "A function value has no stable identity in native code.",
        cases: ["function-values"],
      },
      {
        js: "Tuples are arrays, compared by reference.",
        lucent: "Tuples are values: `===` compares their elements.",
        why: "A tuple is a fixed-size value in native code, not an array.",
        cases: [],
      },
      {
        js: "Two `subarray()` views of one range are different objects.",
        lucent:
          "They are one view: `===`, `indexOf`, and `Map` and `Set` keys compare a view's buffer and range.",
        why: "A view is a buffer and a range, with no identity of its own.",
        cases: ["reference-identity"],
      },
    ],
  },
  {
    title: "Strings, JSON and dates",
    rows: [
      {
        js: "`console.log(obj)` shows the object's structure.",
        lucent: "Prints `String(obj)`.",
        why: "The platform log takes a line of text.",
        cases: ["object-strings"],
      },
      {
        js: "`str.split(regexp)` inserts `undefined` for a capture group that didn't match.",
        lucent: 'Inserts `""`.',
        why: "The result's type is `string[]`.",
        cases: ["regexps"],
      },
      {
        js: "`JSON.parse` returns whatever the text holds.",
        lucent:
          "The text must match the target type. A mismatch throws a `TypeError` naming the path: `JSON.parse: expected a number at .items[2].price, got a string`.",
        why: "The value is built in its type's native layout.",
        cases: ["json"],
      },
      {
        js: "`JSON.stringify` of parsed data keeps the text's key order.",
        lucent: "Keys follow the declared type's order.",
        why: "An object type's fields have one order, the declared one.",
        cases: ["json"],
      },
      {
        js: "`date.toString()` names the time zone in some engines.",
        lucent:
          "Gives `Mon Jul 22 2019 15:51:50 GMT-0700`, as Hermes does. The `toLocale…` methods are refused.",
        why: "Lucent follows React Native's engine, and has no `Intl` for locale formats.",
        cases: ["dates"],
      },
    ],
  },
  {
    title: "The boundary",
    rows: [
      {
        js: "Type annotations are erased: any value reaches a function.",
        lucent:
          "Each argument from JavaScript is checked against its declared type, and a mismatch throws a `TypeError` before the code runs ([The boundary](/docs/api/language/boundary/#when-a-value-doesnt-match)).",
        why: "A native value needs the declared layout.",
        cases: ["null-or-undefined"],
      },
      {
        js: "An exported `let` holding an object is the module's object.",
        lucent:
          "JavaScript reads the binding live, but gets a copy of each object, array, map or set the module assigns. Changes the module makes inside that value don't reach JavaScript ([Modules](/docs/api/language/modules/#exports)).",
        why: "The value is copied at the boundary like any other.",
        cases: ["exported-variables"],
      },
      {
        js: "Arrays and objects passed to other code are shared.",
        lucent: "Copied at the boundary; inside Lucent they're shared.",
        why: "JavaScript objects belong to the JS thread, and Lucent code runs on others.",
        cases: ["reference-identity"],
      },
      {
        js: "`Date` objects passed to other code are shared.",
        lucent: "Copied at the boundary; inside Lucent they're shared.",
        why: "The same as for arrays and objects.",
        cases: ["dates"],
      },
      {
        js: "A function JavaScript passes returns its value whenever it's called.",
        lucent:
          "Called off the JS thread, it's posted there, so it must return `void` or a `Promise`.",
        why: "Lucent code never waits for the JS thread.",
        cases: ["async"],
      },
      {
        js: "A class instance has its fields as own properties.",
        lucent:
          "JavaScript sees public fields as accessors on the prototype, a `readonly` one without a setter, and no other members. `Object.keys` and `JSON.stringify` there see no fields.",
        why: "The instance's fields live in native code, behind one JavaScript object.",
        cases: ["classes"],
      },
      {
        js: "A class's `[Symbol.dispose]()` can be called from JavaScript.",
        lucent: "JavaScript doesn't see the symbol-keyed members of a Lucent class.",
        why: "Lucent gives JavaScript a class's members by name, and a symbol has none.",
        cases: ["using"],
      },
    ],
  },
  {
    title: "Errors and cancellation",
    rows: [
      {
        js: "`error.stack` is a string.",
        lucent:
          "`undefined` in Lucent code, unless the error came from JavaScript. JavaScript receives a `stack` whose first frame is the Lucent one.",
        why: "Native code records the site where it made an error, not a stack.",
        cases: ["errors"],
      },
      {
        js: "`new Error(message, { cause })` keeps the cause.",
        lucent:
          "Refused ([LUCENT1003](/docs/api/diagnostics/#lucent1003)): put what the cause says in the message, or in a field of an error class.",
        why: "A Lucent error carries a name, a message and a code.",
        cases: ["errors"],
        refused: [
          {
            code: "LUCENT1003",
            sample:
              'export function wrap(): Error {\n  return new Error("failed", { cause: new Error("inner") });\n}',
          },
        ],
      },
      {
        js: "`abort()` without a reason gives an `AbortError` whose message depends on the engine.",
        lucent: "`AbortError: signal is aborted without reason`, as in React Native and browsers.",
        why: "One message on both platforms. Node says `This operation was aborted`.",
        cases: ["abort", "listeners"],
      },
      {
        js: "An abort reason can be any value.",
        lucent:
          "A reason from JavaScript becomes an error, with `String(reason)` as its message when it isn't an object. `abort()` in Lucent takes an `Error`.",
        why: "Lucent's errors are `Error` objects.",
        cases: ["abort"],
      },
      {
        js: "`resolve(promise)` in a promise executor adopts the promise.",
        lucent:
          "`resolve` takes a value. Passing a promise fails, in `new Promise` with [LUCENT2002](/docs/api/diagnostics/#lucent2002) and in `fromCallback` with [LUCENT1007](/docs/api/diagnostics/#lucent1007). Await the promise, and resolve with its value.",
        why: "A promise settles once, with a value of its type.",
        cases: ["listeners"],
      },
      {
        js: "`await` on an object without a `then` method gives the object.",
        lucent:
          "`await` on an SDK object is refused ([LUCENT1010](/docs/api/diagnostics/#lucent1010)). Adapt its completion listener with `fromCallback`.",
        why: "Lucent never picks an SDK object's completion API by its name.",
        cases: [],
      },
      {
        js: "A thrown instance of an error class reaches a JavaScript caller as itself.",
        lucent:
          "JavaScript gets an `Error`, `TypeError`, `RangeError` or `SyntaxError` with its `name`, `message` and `code` ([The boundary](/docs/api/language/boundary/#errors)). So `instanceof ParseError` is `false` there, and other fields are dropped.",
        why: "An error crosses as a new JavaScript error made from its values, not as a reference.",
        cases: ["errors", "exported-errors"],
      },
      {
        js: "An error no code can catch, such as a cleanup's, reaches the host's error handler.",
        lucent: "It's written to the platform log (logcat, the unified log) and to stderr.",
        why: "Native code has no JavaScript error handler to call.",
        cases: [],
      },
    ],
  },
  {
    title: "Classes and variables",
    rows: [
      {
        js: "A field read before it's assigned, such as a subclass field read from a base constructor, is `undefined`.",
        lucent:
          'A number, string, boolean, tuple, array, map, set, record or `Uint8Array` reads its default: `0`, `""`, `false` or empty. An object or class reads as unset: using it throws a `TypeError`, through `?.` too.',
        why: "A field holds a native value from the start.",
        cases: ["unassigned-fields"],
      },
      {
        js: "Any object with the right members fits an interface.",
        lucent:
          "Only classes that declare `implements` fit one. A plain JavaScript object is refused at the boundary with a `TypeError`.",
        why: "An interface with methods is a native base class, which only declared classes derive from.",
        cases: ["interfaces"],
      },
      {
        js: "Assigning a static field a class inherits gives the subclass its own.",
        lucent: "From JavaScript, it writes the base class's field, which the subclass shares.",
        why: "A static field is one native variable, on the class that declares it.",
        cases: ["exported-statics"],
      },
    ],
  },
];

/**
 * Known gaps: code that compiles but doesn't do what JavaScript does.
 * Lucent should refuse it or match JavaScript; each row names the cases a
 * fix changes, and a gap without one fails the check.
 */
export const knownGaps: Difference[] = [
  {
    js: "`null` and `undefined` are different values wherever they appear.",
    lucent:
      "Arguments, setter values and object fields from JavaScript keep them apart. Inside arrays, maps, sets, records, tuples, callback results and promise values, a `T | undefined` also takes `null`, and a `T | null` takes `undefined`. Code that then narrows the value to `T` throws a `TypeError`. Test for absence with `== null` or `??`.",
    why: "The boundary's check of an element's absent value isn't written yet.",
    cases: ["null-or-undefined"],
  },
  {
    js: "A `let` or `const` read before its declaration runs throws a `ReferenceError`.",
    lucent:
      "It reads as a field not yet assigned: a value type's default, such as `0`, and for an object a `TypeError` when it's used.",
    why: "Native variables exist from the start, and the read isn't refused yet.",
    cases: ["unassigned-fields", "module-initialization"],
  },
];

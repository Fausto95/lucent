/**
 * Diagnostic codes and what each means: the one source for the CLI (code
 * frames, fix hints, `lucent explain`), the editor plugin and the website.
 * No imports, so `lucent explain` loads it without the compiler.
 *
 * LUCENT1xxx: unsupported syntax; LUCENT2xxx: types that have no native
 * representation; LUCENT3xxx: module structure; LUCENT9xxx: TypeScript
 * errors passed through.
 */
export const Codes = {
  UnsupportedSyntax: "LUCENT1001",
  UnsupportedOperator: "LUCENT1002",
  UnsupportedBuiltin: "LUCENT1003",
  UnsupportedDestructuring: "LUCENT1004",
  UnsupportedClassFeature: "LUCENT1005",
  UnsupportedThrow: "LUCENT1006",
  UnsupportedCall: "LUCENT1007",
  UnsupportedAssignmentTarget: "LUCENT1008",
  UnsupportedLoop: "LUCENT1009",
  AnyType: "LUCENT2001",
  UnsupportedType: "LUCENT2002",
  InexactObject: "LUCENT2003",
  ArrayVariance: "LUCENT2004",
  AmbiguousUnion: "LUCENT2005",
  BoundaryType: "LUCENT2006",
  GenericBoundary: "LUCENT2007",
  InterfaceNotImplemented: "LUCENT2008",
  InterfaceMismatch: "LUCENT2009",
  UnsupportedImport: "LUCENT3001",
  UnsupportedTopLevel: "LUCENT3002",
  UnsupportedExport: "LUCENT3003",
  SdkImport: "LUCENT3004",
  PlatformConformance: "LUCENT3005",
  MainThreadOnly: "LUCENT3006",
  Unavailable: "LUCENT3007",
  TypeScript: "LUCENT9001",
} as const;

export type Code = (typeof Codes)[keyof typeof Codes];

/** Source files by name: an example module, or a module with its platform files. */
export type Example = Record<string, string>;

export interface Explanation {
  /** Short name. */
  title: string;
  /** One sentence: what the code means (tables, hovers). */
  summary: string;
  /** Why Lucent reports it, for `lucent explain`. */
  details: string;
  /** The usual fix, in one line. */
  fix: string;
  /** Code that reports it. */
  wrong: Example;
  /** The same code, fixed. */
  right: Example;
  /** The SDK the examples need, if any. */
  sdk?: "ios" | "android";
}

const ex = (source: string, name = "example.lucent.ts"): Example => ({ [name]: source });

export const Explanations: Record<Code, Explanation> = {
  LUCENT1001: {
    title: "Syntax outside the subset",
    summary: "Syntax outside the subset, such as `var`, getters in object literals, or an async generator.",
    details:
      "Lucent compiles a subset of TypeScript whose every construct has a native equivalent with the same behaviour. `var` (function scoping and hoisting), `with`, labels on blocks, accessors in object literals and async generators fall outside it.",
    fix: "rewrite it with the supported form: `let`/`const` for `var`, a class for an object with accessors",
    wrong: ex("export function total(xs: number[]): number {\n  var sum = 0;\n  for (const x of xs) sum += x;\n  return sum;\n}\n"),
    right: ex("export function total(xs: number[]): number {\n  let sum = 0;\n  for (const x of xs) sum += x;\n  return sum;\n}\n"),
  },
  LUCENT1002: {
    title: "Unsupported operator",
    summary: "An operator used outside what the subset supports, such as `delete`, `in` on anything but a record, or `instanceof` with a generic class.",
    details:
      "Objects in Lucent have a fixed native layout, so an operator that adds or removes properties at run time (`delete`) has no native equivalent. `in` works on records (`Record<string, T>`), whose keys are dynamic, and not on objects with a known shape.",
    fix: "use a Map or a Record for keys that come and go, or an optional field for one that may be missing",
    wrong: ex("export function clear(tags: { name?: string }): { name?: string } {\n  delete tags.name;\n  return tags;\n}\n"),
    right: ex("export function clear(tags: { name?: string }): { name?: string } {\n  tags.name = undefined;\n  return tags;\n}\n"),
  },
  LUCENT1003: {
    title: "Built-in without a native implementation",
    summary: "A built-in function or method Lucent does not implement, such as `Symbol()`, `eval` or an unknown `Math`, `Number` or string method.",
    details:
      "Every built-in a module calls runs as native code from the Lucent runtime. The ones listed in the language reference are implemented with JavaScript's exact semantics; the rest are reported rather than approximated.",
    fix: "use a built-in Lucent implements, or write the helper in the module",
    wrong: ex("export function rotate(xs: number[]): number[] {\n  return xs.copyWithin(0, 1);\n}\n"),
    right: ex("export function rotate(xs: number[]): number[] {\n  return [...xs.slice(1), ...xs.slice(0, 1)];\n}\n"),
  },
  LUCENT1004: {
    title: "Unsupported destructuring",
    summary: "A destructuring form outside the subset: object rest, computed keys, or a pattern without an initializer.",
    details:
      "Object rest (`{ a, ...rest }`) would need a new object type, made of the remaining fields at run time. Computed keys would need a dynamic lookup. Neither has a fixed native layout.",
    fix: "name the fields you need, or pass the whole object",
    wrong: ex("type User = { id: number; name: string; email: string };\nexport function contact(u: User): { name: string; email: string } {\n  const { id, ...rest } = u;\n  return rest;\n}\n"),
    right: ex("type User = { id: number; name: string; email: string };\nexport function contact(u: User): { name: string; email: string } {\n  const { name, email } = u;\n  return { name, email };\n}\n"),
  },
  LUCENT1005: {
    title: "Unsupported class feature",
    summary: "A class feature outside the subset, such as extending a built-in other than `Error`, or an override that changes the native signature.",
    details:
      "Classes compile to C++ classes. A subclass of `Map` or `Array` would inherit the runtime's container internals. An override whose parameters or result differ from the base method's can't share its native slot.",
    fix: "hold the built-in in a field instead of extending it, and keep overrides' signatures the same as the base method's",
    wrong: ex("class Counts extends Map<string, number> {}\nexport function size(): number {\n  return new Counts().size;\n}\n"),
    right: ex("class Counts {\n  readonly map = new Map<string, number>();\n}\nexport function size(): number {\n  return new Counts().map.size;\n}\n"),
  },
  LUCENT1006: {
    title: "Throwing a value that is not an Error",
    summary: "Throwing a value that is not an `Error`.",
    details:
      "Errors cross into JavaScript as `Error` objects with a name, a message and a stack that points at the Lucent source. A thrown string or number has none of that and no native type to catch it by.",
    fix: "throw `new Error(…)`, a built-in error such as `TypeError`, or a class that extends `Error`",
    wrong: ex('export function port(text: string): number {\n  const n = Number(text);\n  if (!Number.isInteger(n)) throw "not a port";\n  return n;\n}\n'),
    right: ex('export function port(text: string): number {\n  const n = Number(text);\n  if (!Number.isInteger(n)) throw new RangeError(`not a port: ${text}`);\n  return n;\n}\n'),
  },
  LUCENT1007: {
    title: "Call Lucent cannot compile",
    summary: "A call Lucent cannot compile, such as spread arguments outside rest parameters, or a platform class without a constructor binding.",
    details:
      "Native calls pass a fixed number of arguments of known types. Spreading an array into ordinary parameters has no native form. Neither does a platform API called as a promise where it has none, or a platform class without an initializer.",
    fix: "pass the arguments one by one, or declare the callee with a rest parameter",
    wrong: ex("function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sum(pair: [number, number]): number {\n  return add(...pair);\n}\n"),
    right: ex("function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sum(pair: [number, number]): number {\n  return add(pair[0], pair[1]);\n}\n"),
  },
  LUCENT1008: {
    title: "Assignment to something that cannot be assigned",
    summary: "An assignment to something that cannot be assigned, such as an unknown field or a function.",
    details: "Assignments write to a native variable or field. A function, an import, or a field the value's type does not have is not one.",
    fix: "assign a variable or a field the type declares",
    wrong: ex("function tick(): number {\n  return 1;\n}\nexport function reset(): void {\n  // @ts-expect-error: assigning a function\n  tick = () => 0;\n}\n"),
    right: ex("let tick = (): number => 1;\nexport function reset(): void {\n  tick = () => 0;\n}\nexport function now(): number {\n  return tick();\n}\n"),
  },
  LUCENT1009: {
    title: "Loop over a value that is not iterable",
    summary: "A loop over a value that is not iterable in Lucent, or `for await`.",
    details:
      "`for…of` works on arrays, strings, maps, sets, typed arrays and generators, and `for…in` on records. Async iteration (`for await`) is not supported: await each promise in an ordinary loop.",
    fix: "loop over an array (`Object.keys`, `Array.from`), or await inside a plain loop",
    wrong: ex("export async function total(xs: Promise<number>[]): Promise<number> {\n  let sum = 0;\n  for await (const x of xs) sum += x;\n  return sum;\n}\n"),
    right: ex("export async function total(xs: Promise<number>[]): Promise<number> {\n  let sum = 0;\n  for (const x of xs) sum += await x;\n  return sum;\n}\n"),
  },
  LUCENT2001: {
    title: "Value without a native type",
    summary: "`any`, or `unknown` outside a `catch` clause: every value needs a native type.",
    details:
      "Native code needs to know each value's layout at compile time. `any` gives it none, and `unknown` only stands for a caught error, whose type JavaScript does not say.",
    fix: "use a concrete type, a union, or a generic parameter",
    wrong: ex("export function size(value: any): number {\n  return value.length;\n}\n"),
    right: ex("export function size(value: string): number {\n  return value.length;\n}\n"),
  },
  LUCENT2002: {
    title: "Type without a native representation",
    summary: "A type with no native representation: intersections, `bigint`, `symbol`, `object`, `WeakMap`, `Intl`, or an index signature mixed with properties.",
    details:
      "Each type maps to one native representation. An intersection can combine unrelated layouts, `bigint` and `symbol` are not implemented yet, and `object` says nothing about the layout.",
    fix: "spell the combined type out as one object type, or use a concrete type",
    wrong: ex("type Named = { name: string };\ntype Aged = { age: number };\nexport function label(p: Named & Aged): string {\n  return `${p.name} (${p.age})`;\n}\n"),
    right: ex("type Person = { name: string; age: number };\nexport function label(p: Person): string {\n  return `${p.name} (${p.age})`;\n}\n"),
  },
  LUCENT2003: {
    title: "Object used as a type with a different shape",
    summary: "An object used as a type with a different shape; object types must match exactly to share a native representation.",
    details:
      "Object types with the same fields share one native struct. TypeScript lets a value with more fields stand for a type with fewer. Natively they are different structs, and the extra fields would have nowhere to go.",
    fix: "pass exactly the fields the type declares, or widen the parameter's type",
    wrong: ex("type Point = { x: number; y: number };\ntype Point3 = { x: number; y: number; z: number };\nfunction norm(p: Point): number {\n  return Math.hypot(p.x, p.y);\n}\nexport function flat(p: Point3): number {\n  return norm(p);\n}\n"),
    right: ex("type Point = { x: number; y: number };\ntype Point3 = { x: number; y: number; z: number };\nfunction norm(p: Point): number {\n  return Math.hypot(p.x, p.y);\n}\nexport function flat(p: Point3): number {\n  return norm({ x: p.x, y: p.y });\n}\n"),
  },
  LUCENT2004: {
    title: "Collection used with another element type",
    summary: "A collection used where its element type would change (`A[]` as `(A | B)[]`); annotate the value with the target type.",
    details:
      "An array of numbers and an array of `number | string` have different native element types. One can't be used as the other: writes through the wider type wouldn't fit.",
    fix: "annotate the collection with the element type it is used as",
    wrong: ex("function first(xs: (number | string)[]): string {\n  return String(xs[0]);\n}\nexport function f(): string {\n  const xs = [1, 2];\n  return first(xs);\n}\n"),
    right: ex("function first(xs: (number | string)[]): string {\n  return String(xs[0]);\n}\nexport function f(): string {\n  const xs: (number | string)[] = [1, 2];\n  return first(xs);\n}\n"),
  },
  LUCENT2005: {
    title: "Union JavaScript values cannot be told apart by",
    summary: "A union JavaScript values cannot be told apart by at the boundary; add a string-literal discriminant.",
    details:
      "A value from JavaScript carries no type, so Lucent decides which union member it is from the value itself. Object members need a string-literal field, such as `kind`, whose value names the member.",
    fix: "add a string-literal field such as `kind: \"circle\"` to each object member",
    wrong: ex("export function area(shape: { radius: number } | { side: number }): number {\n  return \"radius\" in shape ? Math.PI * shape.radius ** 2 : shape.side ** 2;\n}\n"),
    right: ex('export function area(shape: { kind: "circle"; radius: number } | { kind: "square"; side: number }): number {\n  return shape.kind === "circle" ? Math.PI * shape.radius ** 2 : shape.side ** 2;\n}\n'),
  },
  LUCENT2006: {
    title: "Value that cannot cross the JavaScript boundary",
    summary: "A value that cannot cross the JavaScript boundary, such as a generator, a match result, an `AbortSignal` or a platform object.",
    details:
      "Exports convert their parameters and results between JavaScript and native values. Some native values have no JavaScript form: a generator's state, a platform object, a signal made in native code.",
    fix: "return plain data (an array instead of a generator, fields instead of a platform object)",
    wrong: ex("export function* count(n: number): Generator<number> {\n  for (let i = 0; i < n; i++) yield i;\n}\n"),
    right: ex("function* count(n: number): Generator<number> {\n  for (let i = 0; i < n; i++) yield i;\n}\nexport function counted(n: number): number[] {\n  return [...count(n)];\n}\n"),
  },
  LUCENT2007: {
    title: "Generic export",
    summary: "A generic function or class exported to JavaScript; export a concrete wrapper.",
    details:
      "Generics compile to C++ templates, instantiated for the types the module uses. JavaScript calls an export without types, so there is no instantiation to call.",
    fix: "keep the generic function private and export concrete wrappers",
    wrong: ex("export function last<T>(items: T[]): T | undefined {\n  return items[items.length - 1];\n}\n"),
    right: ex("function last<T>(items: T[]): T | undefined {\n  return items[items.length - 1];\n}\nexport function lastName(names: string[]): string | undefined {\n  return last(names);\n}\n"),
  },
  LUCENT2008: {
    title: "Interface not declared with implements",
    summary: "A value used as an interface its class does not declare with `implements`.",
    details:
      "An interface with methods compiles to an abstract C++ base class, and only classes that declare `implements` derive from it. A class that matches the interface only by shape, or an object literal, is not one of them.",
    fix: "add `implements` to the class",
    wrong: ex("interface Shape { area(): number }\nclass Square {\n  constructor(readonly side: number) {}\n  area(): number {\n    return this.side ** 2;\n  }\n}\nexport function area(): number {\n  const s: Shape = new Square(2);\n  return s.area();\n}\n"),
    right: ex("interface Shape { area(): number }\nclass Square implements Shape {\n  constructor(readonly side: number) {}\n  area(): number {\n    return this.side ** 2;\n  }\n}\nexport function area(): number {\n  const s: Shape = new Square(2);\n  return s.area();\n}\n"),
  },
  LUCENT2009: {
    title: "Method signature differs from the interface's",
    summary: "A class member whose native signature differs from the interface member it implements.",
    details:
      "The implementing method overrides the interface's native method, so it needs the same parameter and result types. TypeScript accepts compatible variations (an optional parameter, a narrower result) that are different native signatures.",
    fix: "declare the method with exactly the interface's parameter and result types",
    wrong: ex("interface Store { get(key: string): string | undefined }\nclass Memory implements Store {\n  get(key: string): string {\n    return key;\n  }\n}\nexport function read(): string | undefined {\n  const s: Store = new Memory();\n  return s.get(\"a\");\n}\n"),
    right: ex("interface Store { get(key: string): string | undefined }\nclass Memory implements Store {\n  get(key: string): string | undefined {\n    return key;\n  }\n}\nexport function read(): string | undefined {\n  const s: Store = new Memory();\n  return s.get(\"a\");\n}\n"),
  },
  LUCENT3001: {
    title: "Import from outside Lucent",
    summary: "An import from something other than another `*.lucent.ts` file or a built-in `lucent:` module.",
    details:
      "Everything a module runs is compiled to native code, so it can only use other Lucent modules and the built-in `lucent:` modules (`lucent:core`, `lucent:thread`, `lucent:platform`, the SDKs). An npm package or a plain `.ts` file has no native implementation.",
    fix: "move the code into a *.lucent.ts module, or use a lucent: module",
    wrong: {
      "clock.ts": "export function now(): number {\n  return Date.now();\n}\n",
      "example.lucent.ts": 'import { now } from "./clock";\nexport function stamp(): number {\n  return now();\n}\n',
    },
    right: ex('import { now } from "lucent:core";\nexport function stamp(): number {\n  return now();\n}\n'),
  },
  LUCENT3002: {
    title: "Statement at the top level",
    summary: "A top-level statement that is not a declaration.",
    details:
      "A module's top level holds declarations only: functions, classes, types and variables. Statements that run when the module loads have no native place to run, since native modules are created on first use.",
    fix: "move the statement into a function, or into a variable's initializer",
    wrong: ex("const cache = new Map<string, number>();\ncache.set(\"zero\", 0);\nexport function lookup(k: string): number | undefined {\n  return cache.get(k);\n}\n"),
    right: ex("const cache = new Map<string, number>([[\"zero\", 0]]);\nexport function lookup(k: string): number | undefined {\n  return cache.get(k);\n}\n"),
  },
  LUCENT3003: {
    title: "Unsupported export form",
    summary: "An export form Lucent does not support: export lists, re-exports, default exports.",
    details: "Each export becomes a property of the module's native object, named by its declaration. Export lists, re-exports and default exports name exports apart from their declarations.",
    fix: "put `export` on the declaration itself",
    wrong: ex("function twice(n: number): number {\n  return n * 2;\n}\nexport { twice };\n"),
    right: ex("export function twice(n: number): number {\n  return n * 2;\n}\n"),
  },
  LUCENT3004: {
    title: "Platform SDK import where it cannot be used",
    summary: "A platform SDK import in a file whose platform cannot use it, an SDK module without bindings, or platform code used outside its platform.",
    details:
      "`lucent:ios/*` modules exist on iOS and `lucent:android/*` on Android. A shared module uses them inside `if (PLATFORM === \"ios\")` (or the Android branch), and a `*.ios.lucent.ts` file only its own platform's.",
    fix: "use the SDK inside a PLATFORM branch, or in the platform's own file",
    wrong: ex('import { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\nexport async function model(): Promise<string> {\n  return main(() => UIDevice.current.model);\n}\n'),
    right: ex('import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\nexport async function model(): Promise<string> {\n  if (PLATFORM === "ios") return main(() => UIDevice.current.model);\n  return "unknown";\n}\n'),
    sdk: "ios",
  },
  LUCENT3005: {
    title: "Platform files that do not match their declaration",
    summary: "Platform implementations that do not match their shared declaration file.",
    details:
      "A module split into `name.ios.lucent.ts` and `name.android.lucent.ts` declares its exports in `name.lucent.ts`. Every platform file must export exactly the declared functions, with compatible types, so JavaScript sees one module.",
    fix: "export the same functions, with the declared types, from every platform file",
    wrong: {
      "haptics.lucent.ts": "export declare function tap(): Promise<void>;\n",
      "haptics.ios.lucent.ts": "export async function tap(strength: number): Promise<void> {}\n",
      "haptics.android.lucent.ts": "export async function tap(): Promise<void> {}\n",
    },
    right: {
      "haptics.lucent.ts": "export declare function tap(): Promise<void>;\n",
      "haptics.ios.lucent.ts": "export async function tap(): Promise<void> {}\n",
      "haptics.android.lucent.ts": "export async function tap(): Promise<void> {}\n",
    },
    sdk: "ios",
  },
  LUCENT3006: {
    title: "Main-thread API off the main thread",
    summary: "A main-thread-only platform API used outside `main(() => …)`.",
    details:
      "Lucent code runs on its own thread. UIKit, and other APIs the SDK marks main-thread only, must be called on the main thread. `main(() => …)` from `lucent:thread` runs a function there, and resolves with its result.",
    fix: "wrap the call in main(() => …) from lucent:thread",
    wrong: ex('import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nexport async function model(): Promise<string> {\n  if (PLATFORM === "ios") return UIDevice.current.model;\n  return "unknown";\n}\n'),
    right: ex('import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nimport { main } from "lucent:thread";\nexport async function model(): Promise<string> {\n  if (PLATFORM === "ios") return main(() => UIDevice.current.model);\n  return "unknown";\n}\n'),
    sdk: "ios",
  },
  LUCENT3007: {
    title: "Platform API newer than the oldest supported OS",
    summary: "A platform API newer than the oldest supported OS version, used without an `available()` or `SDK_INT` check around it.",
    details:
      "Apps run on older OS versions than the SDK they build with. An API introduced later crashes there, so Lucent requires a check that the running OS has it.",
    fix: 'check first: if (available("android", 26)) … or Build_VERSION.SDK_INT >= 26',
    wrong: ex('import { PLATFORM } from "lucent:platform";\nimport { VibrationEffect } from "lucent:android/android.os";\nexport async function effect(): Promise<string> {\n  if (PLATFORM === "android") {\n    VibrationEffect.createOneShot(10, 10);\n    return "made";\n  }\n  return "none";\n}\n'),
    right: ex('import { PLATFORM } from "lucent:platform";\nimport { available } from "lucent:android";\nimport { VibrationEffect } from "lucent:android/android.os";\nexport async function effect(): Promise<string> {\n  if (PLATFORM === "android") {\n    if (!available("android", 26)) return "too old";\n    VibrationEffect.createOneShot(10, 10);\n    return "made";\n  }\n  return "none";\n}\n'),
    sdk: "android",
  },
  LUCENT9001: {
    title: "TypeScript error",
    summary: "A TypeScript error. Lucent stops at type errors, because it compiles from the checker's types.",
    details: "Lucent compiles only programs that type-check: every value's native type comes from the TypeScript checker. The message is TypeScript's own.",
    fix: "fix the type error; your editor shows the same message",
    wrong: ex('export function double(n: number): number {\n  return n + "";\n}\n'),
    right: ex("export function double(n: number): number {\n  return n * 2;\n}\n"),
  },
};

/** Where a code is explained on the website. */
export function docsUrl(code: string): string {
  return `https://lucent-lang.dev/docs/reference/diagnostics/#${code.toLowerCase()}`;
}

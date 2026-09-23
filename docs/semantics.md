# Lucent semantics

The specification of what Lucent accepts and how it behaves, for people
working on the compiler and runtime. The user-facing tutorial is the website's
Language section; when the two disagree, this file and the e2e cases win.

A `*.lucent.ts` file must type-check with TypeScript in strict mode, plus
`noUncheckedIndexedAccess`. Lucent accepts the subset below; everything else
gets a `LUCENT` diagnostic that points at the source, never invalid C++.

**The contract: code that type-checks and uses only this subset behaves
exactly like the same code running in JavaScript.** Where Lucent cannot match
JavaScript, it throws rather than silently doing something different, and the
deviation is listed in [Deviations](#deviations-from-javascript). Every item
here is covered by a differential case ([testing.md](testing.md)).

## Modules

```ts
import { delay, error } from "@lucent-lang/core";   // helpers with native implementations
import { parse, type Token } from "./lexer.lucent"; // other Lucent modules

export function f(x: number): number { ... }         // callable from JavaScript
export async function g(): Promise<string> { ... }   // returns a JS promise; runs off the JS thread
export class Store { ... }                            // `new Store()` from JavaScript
export const VERSION = "1.0";                          // copied to JavaScript once
export enum Mode { Fast = "fast", Safe = "safe" }     // becomes a frozen JS object
export type Item = { id: string; tags: string[] };    // types are free

let counter = 0;                                      // module state, reset on JS reload
```

* The top level may only contain declarations.
* Imports are limited to other `*.lucent.ts` files and `@lucent-lang/core`, and
  in platform files to platform SDKs (below).
* Module names are file names without `.lucent.ts`, and must be unique within an app.

### Platform modules

`<name>.ios.lucent.ts` and `<name>.android.lucent.ts` implement the exports
that `<name>.lucent.ts` declares; `lucent:ios/*`, `lucent:android/*` and
`lucent:thread` resolve only in them. The rules are in
[platform-bindings.md](platform-bindings.md).

## Types

| TypeScript | Native representation |
|---|---|
| `number` | `double`, with ECMAScript arithmetic (`%`, `**`, bitwise ops through ToInt32, …); every operation rounds separately, as in JavaScript (no fused multiply-add) |
| `boolean` | `bool` |
| `string` (and string literal types) | immutable UTF-16 string, stored one byte per unit when possible |
| `T[]`, `readonly T[]` | shared array (assignment aliases, like JS) |
| `[A, B]` | tuple (a value) |
| `Record<string, V>`, `{ [k: string]: V }` | string-keyed dictionary, JS key order |
| `Map<K, V>`, `Set<T>` | insertion-ordered, SameValueZero keys |
| object types (`type`, `interface`, literals) | shared struct; types with the same shape share one struct |
| classes | shared object with methods, accessors, statics; `extends` another Lucent class (virtual dispatch, `super`, abstract classes) |
| interfaces with methods, or named in a class's `implements` | abstract base with virtual methods and property accessors; implemented only by classes that declare `implements` |
| `T \| undefined`, `T \| null`, `x?: T` | optional that remembers `undefined` vs `null` |
| other unions | tagged union (`string \| number`, discriminated object unions, …) |
| `(a: A) => R` | function value (closures capture by reference) |
| `Promise<T>` | promise (C++20 coroutine) |
| `Uint8Array` | byte view over a shared buffer |
| `Date` | shared mutable time value; local time from the device's time zone database |
| `Error`, `TypeError`, `RangeError`, `class X extends Error` | error object with `name`, `message`, `code` |
| unconstrained generics `<T>` | C++ templates (functions and classes) |

Not supported: `any`, `unknown` (except in `catch`), intersections, `symbol`,
`bigint`, `object`, getters in object literals, index signatures mixed with
properties, and extending built-in classes other than `Error`. An override
must keep the overridden member's native signature (`LUCENT1005` otherwise).

Interfaces implemented by classes are *nominal*: a class must say
`implements Shape` to be used as a `Shape` (`LUCENT2008` otherwise), and object
literals cannot stand in for them. Each implementing member must have the same
native signature as the interface member (`LUCENT2009`). Interfaces may be
generic (`Source<T>`) and may extend other interfaces; optional and generic
methods cannot be dispatched virtually yet.

## Statements and expressions

Supported:

* `let`/`const` (no `var`), destructuring with defaults and rest, in
  declarations, parameters, `for…of` and assignments.
* `if`, `while`, `do…while`, `for`, `for…of` (arrays, strings by code point,
  `Map`, `Set`, records, `Uint8Array`), `for…in` (records, object types),
  `switch` with fallthrough, labels with `break`/`continue`,
  `try`/`catch`/`finally` (including `return`/`break` inside `try`), `throw`.
* All arithmetic, comparison, bitwise, logical (`&&`, `||` and `??` return the
  operand like JS), and assignment operators, including `??=`, `||=`, `&&=`.
* Optional chaining `a?.b`, `a?.[i]`, `a?.m()`, `f?.()`, and non-null `x!` (checked).
* Template literals, spread in arrays, calls and object literals.
* `typeof`, `instanceof` (classes, `Error` kinds, `Array`, `Map`, …), `in` on records.
* Arrow functions and function expressions, nested function declarations
  (hoisted), recursion. Closures share variables with their enclosing scope,
  and `let` loop variables get a fresh binding per iteration.
* `async`/`await`, `Promise.all`, `Promise.resolve`/`reject`, `delay(ms, signal?)`.
* Regular expressions: literals and `new RegExp(pattern, flags)` with every
  ECMAScript feature and flag (`dgimsuvy`: lookbehind, named groups, Unicode
  property escapes, sets); `exec`, `test`, `lastIndex`; and `match`,
  `matchAll`, `search`, `replace`, `replaceAll` (with `$` patterns or a
  callback) and `split`. A replacement callback that takes capture parameters
  needs a literal pattern; a capture parameter typed `string` throws
  `TypeError` if its group did not participate (type it `string | undefined`).
* Generators (`function*`, generator methods and function expressions) with
  `yield`, `yield*` and `return;`, lazy like JavaScript's; `for…of`, spread,
  `Array.from` and `Iterable<T>` parameters over generators, arrays, sets,
  maps, strings and `Uint8Array`. Leaving a `for…of` early runs the
  generator's `finally` blocks. Not supported: the value of `yield`
  (`next(x)`), returning a value from a generator, async generators.
* `JSON.parse(text) as T` (or into an annotated variable) builds a typed value:
  plain data only (numbers, strings, booleans, `null`, arrays, tuples,
  records, object types, and unions that JSON kinds or a string-literal
  discriminant can tell apart). Revivers are not supported.
* Cancellation: `AbortSignal` (`aborted`, `throwIfAborted()`,
  `addEventListener("abort", listener)`) and `new AbortController()`
  (`signal`, `abort(error?)`). `delay(ms, signal)` rejects with the abort
  reason. `signal.reason` is untyped and not available; catch the error instead.

Evaluation order is JavaScript's (left to right), even where C++ would leave it
unspecified.

## Built-ins

* **Math**: every function and constant.
* **Number**: `isInteger`, `isSafeInteger`, `isFinite`, `isNaN`, `parseInt`,
  `parseFloat`, and the constants; `toString(radix)`, `toFixed`, `toPrecision`,
  `toExponential`. Globals `parseInt`, `parseFloat`, `isNaN`, `isFinite`,
  `String()`, `Number()`, `Boolean()`.
* **String**: `length`, `charAt`, `charCodeAt`, `codePointAt`, `at`, `indexOf`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `slice`, `substring`,
  `substr`, `toUpperCase`/`toLowerCase`, `trim*`, `padStart`/`padEnd`, `repeat`,
  `replace`/`replaceAll` (string patterns), `split` (string separators),
  `concat`, `localeCompare`; `String.fromCharCode`, `String.fromCodePoint`.
* **Array**: `length` (read/write), `push`, `pop`, `shift`, `unshift`, `slice`,
  `splice`, `concat`, `join`, `indexOf`, `lastIndexOf`, `includes`, `find*`,
  `filter`, `map`, `flatMap`, `forEach`, `some`, `every`, `reduce`,
  `reduceRight`, `sort` (stable; default sort compares strings like JS),
  `toSorted`, `reverse`, `toReversed`, `fill`, `at`, `keys`, `values`,
  `entries`; `Array.from` (iterables and `{ length }`), `Array.of`,
  `Array.isArray`, `new Array(n)`.
* **Map / Set**: the full instance API; `new Map(entries)`, `new Set(iterable)`.
* **Object**: `keys`, `values`, `entries` (records, and `keys` for object
  types), `fromEntries`.
* **JSON.stringify** of any Lucent value (no replacer or indent).
* **Strings**: `toUpperCase`/`toLowerCase` use the full Unicode case mappings
  of the root locale (including the final sigma rule), from tables generated by
  `scripts/gen-unicode.ts`. `localeCompare` uses the platform's collator for the
  current locale, like Hermes (CoreFoundation on iOS, `java.text.Collator` on
  Android).
* **console.log / info / debug / warn / error**: written to os_log (iOS) or logcat (Android).
* **Date**: `new Date(…)`, `Date.now()`, `Date.parse`, `Date.UTC`, `get…`/`set…` in local time and UTC, `getTimezoneOffset`, `toISOString`, `toString`, `toDateString`, `toTimeString`, `toUTCString`; not the `toLocale…` methods.
* **@lucent-lang/core**: `delay`, `error(code, message)`, `errorCode(e)`,
  `utf8Encode`, `utf8Decode`, `now()`.

Not supported: `Intl`, `Symbol`, `WeakMap`, `Proxy`, `eval`. Each gives a
diagnostic.

## Crossing the JavaScript boundary

Only exported functions, classes and constants are visible from JavaScript.

* **Arguments are validated**, because JavaScript callers can pass anything:
  `hash: argument 'input' must be a string, got a number`, or for nested values
  `midpoint: argument 'a'.y must be a number, got undefined`.
* **Values are copied:** arrays, records, maps, sets, tuples and plain objects
  cross the boundary as copies. If native code mutates an array it received,
  the caller's array is unchanged.
* **Class instances keep their identity.** The same native object always maps to
  the same JS object, so `===` works. Instances live as long as either side
  holds them.
* **Interface values** cross as their concrete class instance. From JavaScript,
  only instances of Lucent classes that implement the interface are accepted.
* **Unions of object types** need a string-literal discriminant (for example
  `kind: "circle"`) so incoming values can be told apart.
* **Errors** become JS `Error` / `TypeError` / `RangeError` objects with the same
  `name`, `message` and `code`. Their `stack` starts with the Lucent frame
  that created the error (`at parse (/abs/path/config.lucent.ts:12)`). JS
  exceptions thrown by callbacks become Lucent errors that `catch` can handle,
  and keep their original `stack` if they reach JavaScript again.
* **Callbacks** (`(x: number) => void` parameters):
  * called while the JS thread is inside a synchronous call, they run
    synchronously and may return values;
  * called from async code, they are posted to the JS thread, so they must
    return `void` or a `Promise` (which Lucent can `await`).
* **Iterables** can be passed from JavaScript (a snapshot, taken with
  `Array.from`); iterators and generators cannot be returned to JavaScript.
* **AbortSignals** can be passed from JavaScript (for example to an exported
  `async` function) and abort the native side as soon as JavaScript calls
  `controller.abort()`. They cannot be returned to JavaScript, and an
  `AbortController` cannot cross at all.
* **Generic functions and classes** cannot be exported; wrap them in a
  concrete exported function.

## Concurrency model

Lucent code runs **one piece at a time**, like JavaScript. Every entry into
Lucent code holds the Lucent lock: a synchronous call from the JS thread, or a
job on the Lucent thread.

* A synchronous exported function runs on the JS thread.
* An `async` exported function starts on the **Lucent thread**, so heavy work
  does not block the JS thread. Its awaits interleave with other Lucent async
  work exactly as in JavaScript, and its result resolves on the JS thread.
* Lucent code never races with itself, so there are no data races.

Consequence: while a long async computation runs, synchronous calls from
JavaScript wait for it to reach an `await`. Keep synchronous functions short, or
make heavy ones `async`.

## Memory

Objects, arrays, closures and class instances are reference counted. A cycle of
strong references (for example a parent and child that point at each other, or
a closure stored on the object it captures) is never freed. Break such cycles
explicitly, for example by clearing a field.

## Deviations from JavaScript

| JavaScript | Lucent |
|---|---|
| `arr[i] = v` with `i > length` creates holes | throws `RangeError`; append with `push` or assign at `length` |
| `arr[i]` / `record[k]` out of range → `undefined` | same, and the type says `T \| undefined`; `!` throws `TypeError` if absent |
| arrays and objects passed to native code are shared | copied at the boundary (inside Lucent they are shared) |
| garbage collection frees cycles | reference counting leaks cycles |
| deep recursion throws `RangeError` | may overflow the native stack |
| `console.log(obj)` pretty-prints | prints `String(obj)` |
| `str.split(regexp)` inserts `undefined` for a capture group that did not participate | inserts `""` (the result is a `string[]`) |
| `JSON.parse` returns whatever the text contains | the text must match the target type: a mismatch throws `TypeError` naming the path (`expected a number at .items[2].price, got a string`) |
| `JSON.stringify` of parsed data keeps the text's key order | keys follow the declared type's order |
| `Date` objects passed to native code are shared | copied at the boundary (inside Lucent they are shared) |
| `date.toString()` includes the zone name in some engines | `Mon Jul 22 2019 15:51:50 GMT-0700`, like Hermes; `toLocale…` methods are not supported |
| `abort()` without a reason uses an `AbortError` whose message depends on the engine | `AbortError: signal is aborted without reason`, as in React Native and browsers (Node says "This operation was aborted") |
| an abort reason can be any value | reasons from JavaScript become errors (`String(reason)` as the message when it is not an object); `abort()` in Lucent takes an `Error` |
| a subclass field read from a base constructor is `undefined` until the subclass initializes it | it reads the type's default (`0`, `""`, `false`, empty object) |
| any object with the right members satisfies an interface | only classes that declare `implements`; plain JS objects are rejected at the boundary with a `TypeError` |

## Diagnostics

| Code | Meaning |
|---|---|
| `LUCENT1xxx` | unsupported syntax or built-in (`1001` statement/expression, `1003` built-in, `1005` class feature, `1006` throwing a non-Error, …) |
| `LUCENT2xxx` | types without a native representation (`2001` any/unknown, `2003` inexact object types, `2004` array element variance, `2005` ambiguous union at the boundary, `2007` generics at the boundary, `2008` value is not a declared implementation of an interface, `2009` class member does not match its interface) |
| `LUCENT3xxx` | module structure (`3001` imports, `3002` top-level statements, `3003` exports, `3004` SDK imports the file's platform cannot use, `3005` a platform module's files do not match its declaration, `3006` a main-thread-only API outside `main(() => …)`) |
| `LUCENT9001` | a TypeScript error (Lucent stops at type errors) |

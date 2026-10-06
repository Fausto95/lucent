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
import { delay, error } from "lucent:core";          // helpers with native implementations
import { parse, type Token } from "./lexer.lucent"; // other Lucent modules

export function f(x: number): number { ... }         // callable from JavaScript
export async function g(): Promise<string> { ... }   // returns a JS promise; runs off the JS thread
export class Store { ... }                            // `new Store()` from JavaScript
export const VERSION = "1.0";                          // copied to JavaScript once
export enum Mode { Fast = "fast", Safe = "safe" }     // becomes a frozen JS object
export type Item = { id: string; tags: string[] };    // types are free

let counter = 0;                                      // module state, reset on JS reload
```

- The top level may only contain declarations.
- Imports are limited to other `*.lucent.ts` files, `lucent:core`, and
  the `lucent:` platform modules (below).
- Module names are file names without `.lucent.ts`, and must be unique within an app.

### Platform code

A module uses both platforms' SDKs (`lucent:ios/*`, `lucent:android/*`) and
branches on `PLATFORM` from `lucent:platform`: `if (PLATFORM === "ios") { … }
else { … }`. Each platform compiles its own branch, and the top-level
declarations that use its SDK. This is the standard way to write platform
code. Splitting a module into `<name>.ios.lucent.ts` and
`<name>.android.lucent.ts`, implementing what `<name>.lucent.ts` declares, is
the alternative for modules whose platform halves share nothing. The rules
are in [platform-bindings.md](platform-bindings.md).

Native 64-bit integers (Java's `long`, Kotlin's `Long`, `int64_t`, `uint64_t`,
`NSInteger`, `NSUInteger`, Swift's `Int`, `Int64`, `UInt64`) are `bigint`s
in Lucent, so counts, indices, tags and timestamps from the SDK are
bigints: `list.count` is `3n`, and `Number(list.count)` makes it a number.
Every value read from native code is exact, including sentinels at the
type's limits such as `NSNotFound` and `Long.MAX_VALUE`. A bigint passed in
must fit the native type (`0n` to `2n ** 64n - 1n` for unsigned ones), or
the call throws `RangeError` naming the parameter or field. Enums, option
sets and Android constant groups (`@IntDef`, `@LongDef`) stay numbers; a
`@LongDef` value a number cannot hold exactly (beyond ±(2^53 − 1)) throws
`RangeError` instead of rounding.

## Types

| TypeScript                                                  | Native representation                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `number`                                                    | `double`, with ECMAScript arithmetic (`%`, `**`, bitwise ops through ToInt32, …); every operation rounds separately, as in JavaScript (no fused multiply-add) |
| `bigint`                                                    | integer of any precision (`lucent::BigInt`), with ECMAScript's operators; a value that fits in 64 bits does not allocate                                      |
| `boolean`                                                   | `bool`                                                                                                                                                        |
| `string` (and string literal types)                         | immutable UTF-16 string, stored one byte per unit when possible                                                                                               |
| `T[]`, `readonly T[]`                                       | shared array (assignment aliases, like JS)                                                                                                                    |
| `[A, B]`                                                    | tuple (a value)                                                                                                                                               |
| `Record<string, V>`, `{ [k: string]: V }`                   | string-keyed dictionary, JS key order                                                                                                                         |
| `Map<K, V>`, `Set<T>`                                       | insertion-ordered, SameValueZero keys                                                                                                                         |
| object types (`type`, `interface`, literals)                | shared struct; types with the same shape share one struct                                                                                                     |
| classes                                                     | shared object with methods, accessors, statics; `extends` another Lucent class (virtual dispatch, `super`, abstract classes)                                  |
| interfaces with methods, or named in a class's `implements` | abstract base with virtual methods and property accessors; implemented only by classes that declare `implements`                                              |
| `T \| undefined`, `T \| null`, `x?: T`, `null \| undefined` | optional that remembers `undefined` vs `null`                                                                                                                 |
| other unions                                                | tagged union (`string \| number`, discriminated object unions, …)                                                                                             |
| `(a: A) => R`                                               | function value (closures capture by reference)                                                                                                                |
| `Promise<T>`                                                | promise (C++20 coroutine)                                                                                                                                     |
| `Uint8Array`                                                | byte view over a shared buffer                                                                                                                                |
| `Date`                                                      | shared mutable time value; local time from the device's time zone database                                                                                    |
| `Error`, `TypeError`, `RangeError`, `class X extends Error` | error object with `name`, `message`, `code`                                                                                                                   |
| unconstrained generics `<T>`                                | C++ templates (functions and classes)                                                                                                                         |

Not supported: `any`, `unknown` (except in `catch`), intersections, `symbol`,
`object`, getters in object literals, index signatures mixed with
properties, and extending built-in classes other than `Error`. An override
must keep the overridden member's native signature (`LUCENT1005` otherwise).

Interfaces implemented by classes are _nominal_: a class must say
`implements Shape` to be used as a `Shape` (`LUCENT2008` otherwise), and object
literals cannot stand in for them. Each implementing member must have the same
native signature as the interface member (`LUCENT2009`). Interfaces may be
generic (`Source<T>`) and may extend other interfaces; optional and generic
methods cannot be dispatched virtually yet.

## Statements and expressions

Supported:

- `let`/`const` (no `var`), destructuring with defaults and rest, in
  declarations, parameters, `for…of` and assignments.
- `if`, `while`, `do…while`, `for`, `for…of` (arrays, strings by code point,
  `Map`, `Set`, records, `Uint8Array`), `for…in` (records, arrays),
  `switch` with fallthrough, labels with `break`/`continue`,
  `try`/`catch`/`finally` (including `return`/`break` inside `try`), `throw`.
- `using` declarations: the value's `[Symbol.dispose]()` runs however the
  block is left, in reverse order of declaration; `null` and `undefined` are
  skipped. A disposal that throws while an error is pending throws a
  `SuppressedError`. Classes define `[Symbol.dispose]()`, the one
  symbol-keyed member they can have. Not supported: `await using`, and
  `using` directly in a `case` clause (wrap the clause in a block). The
  editor needs `esnext.disposable` (or `esnext`) in tsconfig's `lib`: Expo's
  base config has it, React Native's does not.
- All arithmetic, comparison, bitwise, logical (`&&`, `||` and `??` return the
  operand like JS), and assignment operators, including `??=`, `||=`, `&&=`.
  `===` and `!==` compare arrays, maps, sets, records, `Uint8Array`s,
  promises and class instances by reference, as in JavaScript; tuples are
  values and compare element by element. Functions cannot be compared
  (`LUCENT1002`): not with `===`, not by `indexOf`, `lastIndexOf` or
  `includes`, not as `Map` keys or `Set` elements (`LUCENT2002`), and not
  by a generic that compares a type parameter set to a function type.
- bigint literals (`123n`, `0xffn`, `1_000n`) and every operator on bigints
  but `>>>`, which JavaScript and TypeScript reject: `/` truncates, `%`
  takes the dividend's sign, `**` and shifts at any size, `<` and the other
  relational operators between a bigint and a number compare exact values.
  A `bigint | number` (a constant group's number or a 64-bit value) takes
  `<` and the other relational operators, unary `-` and `~`, and `++`/`--`
  on the kind of value it holds, as in JavaScript.
  Dividing by `0n`, a negative exponent, and a result beyond 2^30 bits throw
  `RangeError`.
- Loose `==` and `!=` between values of one kind, and between `null` or
  `undefined` and anything. Where JavaScript would convert first (a
  number, string, boolean or bigint against another of them, or an object
  against a primitive: `1 == "1"`, `true == 1`, `[1] == 1`) it is rejected
  with `LUCENT1002`, in generics too once instantiated; compare after
  converting, with `===`.
- Optional chaining `a?.b`, `a?.[i]`, `a?.m()`, `f?.()`, and non-null `x!`
  (checked), also as an assignment target: `xs[i]! += 1`.
- Template literals, spread in calls, object literals and arrays (any
  iterable: `[...map]`, `[...set]`, `[...text]`, `[...generator()]`). An
  object literal of an object type spreads objects, and skips an optional
  field the object leaves unset, so `{ ...defaults, ...overrides }` keeps
  the defaults that are not overridden; a record literal spreads records
  of its value type. Spreading `undefined` or `null` adds nothing.
  Spreading an object into a record is refused (`LUCENT1001`): an
  object's fields have no key order nor a record of which optional ones
  are set.
- `typeof`, `instanceof` (classes, `Error` kinds, `Array`, `Map`, …), `in` on records.
- Arrow functions and function expressions, nested function declarations
  (hoisted), recursion. Closures share variables with their enclosing scope,
  and `let` loop variables get a fresh binding per iteration.
- `async`/`await`, `Promise.all`, `Promise.resolve`/`reject`, `delay(ms, signal?)`.
- Regular expressions: literals and `new RegExp(pattern, flags)` with every
  ECMAScript feature and flag (`dgimsuvy`: lookbehind, named groups, Unicode
  property escapes, sets); `exec`, `test`, `lastIndex`; and `match`,
  `matchAll`, `search`, `replace`, `replaceAll` (with `$` patterns or a
  callback) and `split`. A replacement callback that takes capture parameters
  needs a literal pattern; a capture parameter typed `string` throws
  `TypeError` if its group did not participate (type it `string | undefined`).
- Generators (`function*`, generator methods and function expressions) with
  `yield`, `yield*` and `return;`, lazy like JavaScript's; `for…of`, spread,
  `Array.from` and `Iterable<T>` parameters over generators, arrays, sets,
  maps, strings and `Uint8Array`. Leaving a `for…of` early runs the
  generator's `finally` blocks. Not supported: the value of `yield`
  (`next(x)`), returning a value from a generator, async generators.
- `JSON.parse(text) as T` (or into an annotated variable) builds a typed value:
  plain data only (numbers, strings, booleans, `null`, arrays, tuples,
  records, object types, and unions that JSON kinds or a string-literal
  discriminant can tell apart). Revivers are not supported.
- Cancellation: `AbortSignal` (`aborted`, `throwIfAborted()`,
  `addEventListener("abort", listener)`) and `new AbortController()`
  (`signal`, `abort(error?)`). `delay(ms, signal)` rejects with the abort
  reason. `signal.reason` is untyped and not available; catch the error instead.

Evaluation order is JavaScript's (left to right), even where C++ would leave it
unspecified. An assignment evaluates its target's object and key once, first;
a compound assignment (`x += f()`) then reads the target before the right side
runs, so a right side that changes the target does not change what is read.

## Built-ins

- **Math**: every function and constant.
- **BigInt**: `BigInt(x)` of a number (`RangeError` unless an integer), a
  string (`SyntaxError`, which `instanceof SyntaxError` recognizes, unless
  an integer literal), a boolean or a bigint, or a union of them
  (`bigint | number`);
  `BigInt.asIntN`, `BigInt.asUintN`; `toString(radix)`, `valueOf`.
  `Number(x)` rounds to the nearest double (ties to even), also of a union
  with numbers, strings, booleans and absent values (`Number(undefined)` is
  `NaN`, `Number(null)` is `0`); `String(x)` and template
  literals print the decimal digits. `JSON.stringify` of a bigint throws
  `TypeError`, as in JavaScript, and `JSON.parse` cannot create one.
- **Number**: `isInteger`, `isSafeInteger`, `isFinite`, `isNaN`, `parseInt`,
  `parseFloat`, and the constants; `toString(radix)`, `toFixed`, `toPrecision`,
  `toExponential`. Globals `parseInt`, `parseFloat`, `isNaN`, `isFinite`,
  `String()`, `Number()`, `Boolean()`.
- **String**: `length`, `charAt`, `charCodeAt`, `codePointAt`, `at`, `indexOf`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `slice`, `substring`,
  `substr`, `toUpperCase`/`toLowerCase`, `trim*`, `padStart`/`padEnd`, `repeat`,
  `replace`/`replaceAll` (string patterns), `split` (string separators),
  `concat`, `localeCompare`; `String.fromCharCode`, `String.fromCodePoint`.
- **Array**: `length` (read/write), `push`, `pop`, `shift`, `unshift`, `slice`,
  `splice`, `concat`, `join`, `indexOf`, `lastIndexOf`, `includes`, `find`,
  `findIndex`, `filter`, `map`, `flatMap`, `forEach`, `some`, `every`,
  `reduce`, `reduceRight`, `sort` (stable; default sort compares strings
  like JS), `reverse`, `fill`, `at`, `keys`, `values`,
  `entries`; `Array.from` (iterables and `{ length }`), `Array.of`,
  `Array.isArray`, `new Array(n)`.
- **Map / Set**: the full instance API; `new Map(entries)`, `new Set(iterable)`.
- **Object**: `keys`, `values`, `entries` (records), `fromEntries`. Object
  types refuse `Object.keys`, `values`, `entries`, `for…in` and `in` (even
  on a required field): their native layout records neither which optional
  fields are set nor the order JavaScript made them in, both of which
  JavaScript shows.
- **JSON.stringify** of any Lucent value (no replacer or indent). A class
  instance writes every field JavaScript creates on it, `private` and
  `protected` ones too (TypeScript visibility does not change serialization):
  base class fields first, parameter properties before declared fields, never
  `#` fields, statics or accessors; through a base-typed value it writes as
  its own class, generic classes included. A `toJSON()` method's value
  replaces the fields, and so does a `toJSON` function property without
  parameters on an object; that value's own `toJSON` is not called again.
  When it is `undefined` or a function, an object omits the property and an
  array writes `null`. A `toJSON` method that declares parameters
  (JavaScript passes it the key) is refused (`LUCENT1005`); a `toJSON`
  function property that declares them is written as a function (omitted),
  not called.
- **Strings**: `toUpperCase`/`toLowerCase` use the full Unicode case mappings
  of the root locale (including the final sigma rule), from tables generated by
  `scripts/gen-unicode.ts`. `localeCompare` uses the platform's collator for the
  current locale, like Hermes (CoreFoundation on iOS, `java.text.Collator` on
  Android).
- **console.log / info / debug / warn / error**: written to os_log (iOS) or logcat (Android).
  A bigint argument prints with its `n` (`1n`), as JavaScript consoles print it.
- **Date**: `new Date(…)`, `Date.now()`, `Date.parse`, `Date.UTC`, `get…`/`set…` in local time and UTC, `getTimezoneOffset`, `toISOString`, `toString`, `toDateString`, `toTimeString`, `toUTCString`; not the `toLocale…` methods.
- **lucent:core**: `delay`, `error(code, message)`, `errorCode(e)`,
  `utf8Encode`, `utf8Decode`, `now()`, `fromCallback(register, signal?)`,
  `subscribe(register, onValue, signal?)`, `NativeBuffer`.
- **Callback APIs** (a native listener, say) become promises with
  `fromCallback`, which settles on what the API reports once, and
  subscriptions with `subscribe`, which passes each value to `onValue` until
  the subscription ends. Neither knows the API: `register` starts
  listening, at once, and may return the cleanup that stops it.
  - The first of the callbacks (`resolve`/`reject`; `end`/`fail`, or
    `onValue` throwing, for a subscription) and the signal aborting settles
    the promise. Later callbacks do nothing, `next` included.
  - The cleanup runs exactly once, inside the call that settles, before any
    continuation of the promise; or right after `register` returns, if it
    settled during registration.
  - A throw from `register` rejects the promise, unless it had settled. An
    already aborted signal rejects it with the signal's reason, and
    `register` is not called.
  - A cleanup that throws is reported as uncaught; the promise keeps its
    outcome.
  - The callbacks may be called from any thread: they take effect on the
    thread `fromCallback` or `subscribe` was called on, in the order they
    were called.

- **Native buffers** (`NativeBuffer` from `lucent:core`) are bytes native
  code owns, which move instead of being copied. A `Uint8Array` keeps its
  copy semantics everywhere.
  - `NativeBuffer.allocate(size)` (zeroed; a `RangeError` unless `size` is a
    whole number from 0) and `NativeBuffer.from(bytes)` (a copy) make one;
    `byteLength` is 0 once it is closed or transferred.
  - The bytes are reached through a borrow for one call:
    `withRead(read)` lends `read` a `ByteSpan`, `withWrite(write)` lends
    `write` a `MutableByteSpan`, and each returns what its callback returns.
    A span has `length`, `span[i]` (undefined out of range), and when
    writable `span[i] = v` (wrapping to 0–255, ignored out of range),
    `fill(value, start?, end?)` and `set(uint8Array, offset?)`. Reads
    share the buffer; a write needs it to itself; a borrow, close or
    transfer that conflicts with one in progress throws an
    `InvalidStateError` (`NativeBuffer is borrowed`) at once.
  - A span stays in its callback: returning it, storing it, capturing it in
    a closure that outlives the call, passing it to code that keeps it, or
    an `async` callback is refused (`LUCENT3030`). The callback is a
    function literal or the name of a function, so the compiler can check it.
  - `transfer()` moves the bytes, uncopied, to a new buffer; every reference
    to the old one then throws `InvalidStateError` (`NativeBuffer was
transferred`) on use, and closing it does nothing. Passing a buffer to
    `compute`, alone or inside the input, moves it the same way (a borrowed
    buffer does not move: the promise rejects), and a task's buffer comes
    back as it is. A use the compiler can tell certainly follows a move is
    refused (`LUCENT3031`); other aliases are refused at run time.
  - `close()`, or `using`, releases the bytes; after that the buffer throws
    `NativeBuffer is closed` on use. Closing twice does nothing.
  - `toUint8Array()` and `from` are the only copies. `NativeBuffer.stats()`
    counts allocations, transfers and copies (and the bytes copied) since
    the app started, to check that a path does not copy.

The ES2023 methods (`toSorted`, `toReversed`, `findLast`, `findLastIndex`)
are not available: modules are checked against the ES2022 library.

Not supported: `Intl`, `Symbol`, `WeakMap`, `Proxy`, `eval`. Each gives a
diagnostic.

## Crossing the JavaScript boundary

Only exported functions, classes and constants are visible from JavaScript.

- **Arguments are validated**, because JavaScript callers can pass anything:
  `hash: argument 'input' must be a string, got a number`, or for nested values
  `midpoint: argument 'a'.y must be a number, got undefined`.
- **Values are copied:** arrays, records, maps, sets, tuples and plain objects
  cross the boundary as copies. If native code mutates an array it received,
  the caller's array is unchanged. A plain object reaches JavaScript with
  its fields in its type's order (see the deviations), without the
  optional ones left unset.
- **Class instances keep their identity.** The same native object always maps to
  the same JS object, so `===` works. Instances live as long as either side
  holds them.
- **Interface values** cross as their concrete class instance. From JavaScript,
  only instances of Lucent classes that implement the interface are accepted.
- **Unions of object types** need a string-literal discriminant (for example
  `kind: "circle"`) so incoming values can be told apart.
- **bigints** cross exactly, as JavaScript bigints, at any size.
- **Errors** become JS `Error` / `TypeError` / `RangeError` / `SyntaxError` objects with the same
  `name`, `message` and `code`. Their `stack` starts with the Lucent frame
  that created the error (`at parse (/abs/path/config.lucent.ts:12)`). JS
  exceptions thrown by callbacks become Lucent errors that `catch` can handle,
  and keep their original `stack` if they reach JavaScript again.
- **Callbacks** (`(x: number) => void` parameters):
  - called while the JS thread is inside a synchronous call, they run
    synchronously and may return values;
  - called from async code, they are posted to the JS thread, so they must
    return `void` or a `Promise` (which Lucent can `await`).
- **Iterables** can be passed from JavaScript (a snapshot, taken with
  `Array.from`); iterators and generators cannot be returned to JavaScript.
- **AbortSignals** can be passed from JavaScript (for example to an exported
  `async` function) and abort the native side as soon as JavaScript calls
  `controller.abort()`. They cannot be returned to JavaScript, and an
  `AbortController` cannot cross at all.
- **NativeBuffers** cross as opaque handles that keep their identity, like
  class instances, with the same `byteLength`, `withRead`, `withWrite`,
  `toUint8Array`, `transfer` and `close`. JavaScript is never given memory
  a worker may be writing: its borrows lend it a copy of the bytes (counted
  by `stats()`), copied back when `withWrite`'s callback returns. So a
  `Uint8Array` a JavaScript callback keeps does not follow the buffer, where
  under the JavaScript implementation of `lucent:core` (tests) it is the
  buffer's own bytes. Spans cannot cross (`LUCENT2006`).
- **Generic functions and classes** cannot be exported; wrap them in a
  concrete exported function.
- **A union holding a type parameter** (`A | B`, `T | undefined`) keeps
  its shape in every instantiation, since a generic compiles once, so a
  type argument cannot merge into it (`LUCENT2002`): not an optional,
  `null` or `undefined`, and in `A | B` not a union nor a type the union
  already holds (`pick<number, number>`).

## Concurrency model

Lucent code runs **one piece at a time**, like JavaScript. Every entry into
Lucent code holds the Lucent lock: a synchronous call from the JS thread, or a
job on the Lucent thread.

- A synchronous exported function runs on the JS thread.
- An `async` exported function starts on the **Lucent thread**, so heavy work
  does not block the JS thread. Its awaits interleave with other Lucent async
  work exactly as in JavaScript, and its result resolves on the JS thread.
- Lucent code never races with itself, so there are no data races.

Consequence: while a long async computation runs, synchronous calls from
JavaScript wait for it to reach an `await`. Keep synchronous functions short, or
make heavy ones `async`.

## Memory

Objects, arrays, closures and class instances are reference counted. A cycle of
strong references (for example a parent and child that point at each other, or
a closure stored on the object it captures) is never freed. Break such cycles
explicitly, for example by clearing a field.

## Deviations from JavaScript

| JavaScript                                                                                      | Lucent                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arr[i] = v` with `i > length` creates holes                                                    | throws `RangeError`; append with `push` or assign at `length`                                                                                                                                                                                                                                                            |
| `arr[i]` / `record[k]` out of range → `undefined`                                               | same, and the type says `T \| undefined`; `!` throws `TypeError` if absent                                                                                                                                                                                                                                               |
| arrays and objects passed to native code are shared                                             | copied at the boundary (inside Lucent they are shared)                                                                                                                                                                                                                                                                   |
| garbage collection frees cycles                                                                 | reference counting leaks cycles                                                                                                                                                                                                                                                                                          |
| deep recursion throws `RangeError`                                                              | may overflow the native stack                                                                                                                                                                                                                                                                                            |
| `==` converts first between a number, string, boolean, bigint or object (`1 == "1"`)            | refused (`LUCENT1002`); compare with `===` after converting                                                                                                                                                                                                                                                              |
| functions compare by reference                                                                  | comparing two functions is rejected (`LUCENT1002`): a function value has no stable identity                                                                                                                                                                                                                              |
| tuples are arrays and compare by reference                                                      | tuples are values: `===` compares their elements                                                                                                                                                                                                                                                                         |
| two `subarray()` views of one range are different objects                                       | they are one view: `===`, `indexOf` and `Map`/`Set` keys compare a view's buffer and range                                                                                                                                                                                                                               |
| `console.log(obj)` pretty-prints                                                                | prints `String(obj)`                                                                                                                                                                                                                                                                                                     |
| `str.split(regexp)` inserts `undefined` for a capture group that did not participate            | inserts `""` (the result is a `string[]`)                                                                                                                                                                                                                                                                                |
| `JSON.parse` returns whatever the text contains                                                 | the text must match the target type: a mismatch throws `TypeError` naming the path (`expected a number at .items[2].price, got a string`)                                                                                                                                                                                |
| `JSON.stringify` of parsed data keeps the text's key order                                      | keys follow the object type's fixed order (next row)                                                                                                                                                                                                                                                                     |
| an object's keys come in the order they were added (`{ d: "y", ...p, a: 5 }` lists `d` first)   | an object type's keys come in one fixed order: its fields' order in the first type with those fields the compiler meets (types with the same fields share one struct). `JSON.stringify` and the objects JavaScript receives follow it (`Object.keys` and `for…in` refuse object types); use a record where order matters |
| `{ b: undefined }` has a key `b`, and spreading it sets `b` to `undefined`                      | an optional field holding `undefined` is a field left unset: `JSON.stringify` and the boundary leave it out, and spreading skips it                                                                                                                                                                                      |
| `Date` objects passed to native code are shared                                                 | copied at the boundary (inside Lucent they are shared)                                                                                                                                                                                                                                                                   |
| `date.toString()` includes the zone name in some engines                                        | `Mon Jul 22 2019 15:51:50 GMT-0700`, like Hermes; `toLocale…` methods are not supported                                                                                                                                                                                                                                  |
| `abort()` without a reason uses an `AbortError` whose message depends on the engine             | `AbortError: signal is aborted without reason`, as in React Native and browsers (Node says "This operation was aborted")                                                                                                                                                                                                 |
| an abort reason can be any value                                                                | reasons from JavaScript become errors (`String(reason)` as the message when it is not an object); `abort()` in Lucent takes an `Error`                                                                                                                                                                                   |
| a subclass field read from a base constructor is `undefined` until the subclass initializes it  | it reads the type's default (`0`, `""`, `false`, empty object)                                                                                                                                                                                                                                                           |
| any object with the right members satisfies an interface                                        | only classes that declare `implements`; plain JS objects are rejected at the boundary with a `TypeError`                                                                                                                                                                                                                 |
| a class instance in JavaScript has its fields as own properties, `private` ones included        | public fields are prototype accessors, other members hidden: `Object.keys` and `JSON.stringify` see no fields                                                                                                                                                                                                            |
| a class's `[Symbol.dispose]()` is callable from JavaScript                                      | it is for Lucent code: JavaScript does not see symbol-keyed members of Lucent classes                                                                                                                                                                                                                                    |
| `resolve(promise)` in a promise executor adopts the promise                                     | `fromCallback` reports values, not promises: a promise type is refused (`LUCENT1007`); await it and report its value                                                                                                                                                                                                     |
| `await` on an object without a `then` method gives the object                                   | `await` on a platform SDK object is refused (`LUCENT1010`): adapt its completion listener with `fromCallback`                                                                                                                                                                                                            |
| an error nobody catches (a `fromCallback` cleanup that throws) reaches the host's error handler | it is written to the platform log (logcat, the unified log) and stderr                                                                                                                                                                                                                                                   |

## Diagnostics

| Code         | Meaning                                                                                                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LUCENT1xxx` | unsupported syntax or built-in (`1001` statement/expression, `1003` built-in, `1005` class feature, `1006` throwing a non-Error, `1010` await on a native object, …)                                                                                                                                                                          |
| `LUCENT2xxx` | types without a native representation (`2001` any/unknown, `2003` inexact object types, `2004` array element variance, `2005` ambiguous union at the boundary, `2007` generics at the boundary, `2008` value is not a declared implementation of an interface, `2009` class member does not match its interface)                              |
| `LUCENT3xxx` | module structure (`3001` imports, `3002` top-level statements, `3003` exports, `3004` SDK imports the file's platform cannot use, `3005` a platform module's files do not match its declaration, `3006` a main-thread-only API outside `main(() => …)`, `3007` an Android API newer than the oldest supported level, outside a version check) |
| `LUCENT9001` | a TypeScript error (Lucent stops at type errors)                                                                                                                                                                                                                                                                                              |

# Lucent semantics

What Lucent accepts and how it behaves, for people who change the
compiler and the runtime. Users read the website's
[API › Language](https://lucent-lang.dev/docs/api/language/) pages, built
from `apps/website/src/docs/language.ts`, which `node scripts/website.ts`
checks. When this file, the website and the compiler disagree, the e2e
cases in `packages/compiler/test/e2e/cases/` decide, and the other two
change in the same commit ([decision 0050](decisions/0050-docs-and-specs-have-one-owner-each.md)).

## The contract

A `*.lucent.ts` file type-checks in strict mode with
`noUncheckedIndexedAccess`, against the ES2024 library and
`esnext.disposable` (`program.ts`). Lucent adds `console` and
`AbortController` (`packages/compiler/lib/globals.d.ts`) and the `lucent:`
modules (`packages/compiler/lib/sdk/*.d.ts`).

**Code that type-checks and uses only the subset behaves exactly like the
same code run as JavaScript.** The e2e runner builds each case into a
Hermes host, runs its script through JSI and against the source run as
JavaScript, and compares the outputs line by line ([testing.md](testing.md)).
Each case's first comment says what it tests. Three rules follow:

- **Exact or refused.** What Lucent can't match fails with a `LUCENT`
  diagnostic at the source, never with invalid C++
  ([decision 0045](decisions/0045-a-built-in-is-exact-or-refused.md)).
- **A deviation has a reason.** Native behavior that can't match
  JavaScript is listed in [Deviations](#deviations-from-javascript) with
  its reason, and in `language.ts`.
- **A known gap is a bug.** Code that compiles and differs without a
  reason gets a known-gap row, a case around it, and a task.

## Values and types

`LType` in `packages/compiler/src/types.ts` gives each TypeScript type one
native representation. `runtime/cpp/lucent/core.h` holds the value model:
primitives by value, and objects as reference-counted handles that alias
on assignment, as JavaScript objects do.

| TypeScript                                          | Native representation                                |
| --------------------------------------------------- | ---------------------------------------------------- |
| `number`, `bigint`, `boolean`                       | `double`, `lucent::BigInt` of any precision, `bool`  |
| `string`, string and template literal types         | `lucent::String`: immutable UTF-16, shared           |
| `T \| undefined`, `T \| null`, `x?: T`              | `Opt<T>`: undefined, null or a value                 |
| other unions                                        | `std::variant` of the members                        |
| `T[]`; `[A, B]`                                     | a shared array; a `std::tuple`, which is a value     |
| `Record<string, V>`, `Map<K, V>`, `Set<T>`          | shared, ordered collections                          |
| object types, data-only interfaces, mapped types    | a shared struct, one per shape                       |
| classes                                             | a shared object: fields, methods, accessors, statics |
| interfaces with methods, or that a class implements | an abstract base class with virtual members          |
| `(a: A) => R`; `Promise<T>`                         | a function value; a promise (`async` is a coroutine) |
| `Uint8Array`, `ArrayBuffer`, `Date`, `RegExp`       | a byte view, bytes, a time value, a compiled pattern |
| `Error` kinds, `class X extends Error`              | an error object: `name`, `message`, `code`           |
| type parameters                                     | C++ templates                                        |

### Numbers and bigints

A `number` is a `double` with ECMAScript arithmetic: `%`, `**`, and
bitwise operators through ToInt32 (`>>>` through ToUint32). Each operation
rounds on its own: every build passes `-ffp-contract=off`. Integer
inference (`emit/integers.ts`) keeps a local in an integer register when
every write is a proven exact integer; reads convert back, so no result
changes ([decision 0063](decisions/0063-a-value-only-its-own-local-sees-may-change-representation.md)).

Bigint operators match JavaScript's: `/` truncates, `%` takes the
dividend's sign, and `<` compares a bigint with a number exactly. Mixing
a bigint and a number in arithmetic is `LUCENT1002`. Dividing by `0n`, a
negative exponent and a result beyond 2^30 bits (V8's limit) throw
`RangeError`. A `bigint | number` from an SDK takes relational operators,
`-`, `~`, `++` and `--` on the kind it holds.

### Strings and absent values

A string is immutable UTF-16, stored one byte per unit when every unit
fits (`jsstring.h`). Lone surrogates are valid and cross the boundary
intact, and `for…of` iterates by code point. `String(x)`, templates and
`+` give JavaScript's text: arrays and byte views join with `,`, other
objects name their class (`[object Map]`).

`T | undefined`, `T | null`, `x?: T` and `null | undefined` lower to
`Opt<T>`, whose three states keep `=== null` and `=== undefined` as in
JavaScript. `x!` is a checked unwrap: `TypeError` on an absent value. An
optional field holding `undefined` is unset: `JSON.stringify` and the
boundary leave it out, and spreading skips it.

### Arrays, tuples and collections

An array has no holes: each element holds a value of its type. So
`a[i] = v` past the end, `a[-1] = v`, `a[1.5] = v` and a larger `length`
throw `RangeError`; a smaller `length` works. `new Array(n)` needs a whole
`.fill(v)` after it, and `Array.from({ length: n })` needs a map function
unless the elements may be `undefined` (`LUCENT1003`). A literal with
holes is `LUCENT1001`. An `A[]` can't stand for an `(A | B)[]`
(`LUCENT2004`): the element layouts differ.

A tuple is a fixed-size value: `===` compares its elements. It is read
with a literal index (`LUCENT1001`), its elements can't be assigned
(`LUCENT1008`), and array methods on it are refused (`LUCENT1003`).

A record is a string-keyed dictionary in JavaScript's key order:
integer-like keys ascending, then insertion order (`map.h`).
`delete record[key]` works, and `in` sees inherited keys
(`"toString" in r`). `Map` and `Set` keep insertion order and compare keys
by SameValueZero (a `-0` key is stored as `0`). Numeric index signatures,
and functions or `JSValue`s as keys, are refused (`LUCENT2002`).

### Object types

Object types with the same fields share one struct, whose field order is
that of the first such type the compiler meets. `JSON.stringify` and the
objects JavaScript receives follow it. A value has exactly its type's
fields (`LUCENT2003`): TypeScript lets `{ x, y, z }` stand for `{ x, y }`,
but `z` would have nowhere to go.

A struct records neither which optional fields are set nor the order
JavaScript added them. So on object types `Object.keys`, `values` and
`entries` (`LUCENT1003`), `for…in` (`LUCENT1009`), `in` and `delete`
(`LUCENT1002`) and `obj[key]` (`LUCENT1001`) are refused
([decision 0042](decisions/0042-optional-fields-presence-is-refused-not-guessed.md)).
Methods in object types (`LUCENT2002`) and getters in literals
(`LUCENT1001`) are refused; a function-valued property works.

### Interfaces

An interface of properties alone that no class implements is an object
type, structural like any other. One with methods, or that a class names
in `implements`, is an abstract base class, and nominal: only a class
that declares `implements Shape` is a `Shape` (`LUCENT2008`). An object
literal also fits such an interface when the interface has properties
alone and no type parameters; JavaScript receives it as a plain object.

An implementing member has exactly the interface member's native
signature (`LUCENT2009`), where TypeScript also accepts a narrower result
or an extra optional parameter. Optional and generic interface methods
can't be dispatched yet (`LUCENT2009`).

### Classes

Classes have fields, `#private` members, methods, accessors, statics,
abstract members and parameter properties. A class extends another Lucent
class (virtual dispatch, `super`), `Error`, or an SDK class
([platform-bindings.md](platform-bindings.md)), and without a constructor
gets JavaScript's implicit one. Refused with `LUCENT1005`: extending
other built-ins, an override with another native signature, overriding a
generic method, static blocks, static fields in generic classes,
decorators ([decision 0043](decisions/0043-decorators-and-default-exports-are-refused.md)),
index signatures, and computed names but `[Symbol.dispose]`. Class
expressions are `LUCENT2002`.

A field read before it is assigned (from a base constructor) reads a
value type's default: `0`, `""`, `false` or empty. An object-typed one is
unassigned, and using it throws `TypeError`, through `?.` too, where
JavaScript reads `undefined`
([decision 0044](decisions/0044-a-read-before-assignment-throws-never-crashes.md)).

### Generics

Generics compile to C++ templates, one instantiation per set of type
arguments. A constraint gives no member access (`v.x` on
`T extends { x: number }` is `LUCENT1003`). A generic function can't be a
value (`LUCENT1001`) or an export (`LUCENT2007`), and `instanceof` a
generic class is `LUCENT1002`.

A union holding a type parameter keeps its shape in every instantiation,
so a type argument that would merge into it is `LUCENT2002`. Each
instantiation of a generic class is a class of its own: an existing
`Box<number>` can't be a `Box<number | undefined>` (`LUCENT2004`), though
a `new` builds the instantiation its value becomes.

### Unions, enums and other types

A union other than an optional is a tagged variant. Narrowing by
`typeof`, `instanceof`, `Array.isArray`, `===` and a string-literal
discriminant works; `in` on a union is `LUCENT1002`. A member every type
of the union declares is read or called on the union's value. `x as T`
taking a member out of a union checks it, and another member throws
`TypeError`, since the variant holds one layout.

Literal types widen to their base type. A string enum is a string, a
numeric enum a number, a mixed one a union, and members are constants
(`LUCENT3002`). Lucent code can't map a value back to its name (`E[0]`,
`LUCENT1001`), but an exported numeric enum's JavaScript object has the
reverse mapping. A call typed `never` may stand wherever a value goes.

`any`, and `unknown` outside `catch`, have no layout (`LUCENT2001`).
`LUCENT2002` refuses intersections, `symbol`, `object`, `Function`,
`Intl` types, mixed index signatures, overloaded and constructor function
types, and `SharedArrayBuffer`. Typed arrays other than `Uint8Array`, and
`DataView`, are [T100](tasks.md#t100). A recursive union alias
(`type Json = … | Json[]`) crashes the compiler today ([T102](tasks.md#t102)).

## Statements and expressions

`let` and `const` work; `var` is `LUCENT1001`. Destructuring works in
declarations, parameters, `for…of` and assignments, with defaults and
array rest. Object rest ([T106](tasks.md#t106)), computed keys and
destructuring in `catch` are `LUCENT1004`. A `let` or `const` read before
its declaration runs reads as an unassigned field does, where JavaScript
throws `ReferenceError`: a known gap.

`if`, the loops, `switch` with fallthrough, labels,
`try`/`catch`/`finally` (with `return` and `break` inside) and `throw`
work. `for (let …)` gives each iteration its own binding, even when the
body assigns it. `for…of` iterates arrays, strings, maps, sets, byte
views, generators and `Iterable<T>`; `for…in` iterates records and arrays.
`for await` is `LUCENT1009` ([T106](tasks.md#t106)). `debugger`, tagged
templates (`String.raw`), `new.target`, `arguments` and `this` outside
class members are `LUCENT1001`.

Every operator works, `??=`, `||=` and `&&=` included. Optional chaining
works in every form, and as an assignment target with `!`
(`xs[i]! += 1`). `===` compares arrays, maps, sets, records, promises and
instances by reference, tuples by value, and byte views by buffer and
range (`bytes.h`).

Functions can't be compared, by `===`, `indexOf`, `includes` or as keys
(`LUCENT1002`, `LUCENT2002`): a named function is a new value at each
use. Loose `==` works between values of one kind and against `null` or
`undefined`; where JavaScript converts first (`1 == "1"`) it is
`LUCENT1002`, in generics too.

Spread works into built-ins that take any number of arguments
(`push(...xs)`, `Math.min(...xs)`) and into array literals from any
iterable, and into a function's rest parameter. Into fixed parameters,
or from a tuple, it is `LUCENT1007` ([T106](tasks.md#t106)). An object literal spreads objects, skipping
optional fields left unset, so `{ ...defaults, ...overrides }` keeps the
defaults; `undefined` and `null` spread as nothing. A record literal
spreads records only (`LUCENT1001`).

**Evaluation order** is JavaScript's, left to right, even where C++
leaves it unspecified: the IR orders a plan's operands in source order
(`operands` in `ir/lower.ts`). An assignment evaluates its target's
object and key once, first. A compound assignment reads the target before
the right side runs, and a right side that throws stores nothing.

## Functions, errors and `using`

Declarations (hoisted, nested ones too), arrows, function expressions,
recursion, default and rest parameters work. A closure shares variables
with its scope: a captured variable that changes is boxed (`Box` in
`core.h`), and a coroutine frame owns its captures. A function with a rest
parameter is called, not passed, and a function type has no rest
parameter (`LUCENT2002`). Overloads (`LUCENT3002`), `call`, `apply` and
`bind` (`LUCENT1003`) and functions with properties (`LUCENT2002`) are
refused.

Only errors are thrown: `Error`, `TypeError`, `RangeError`, `SyntaxError`
and classes extending `Error` (`LUCENT1006` otherwise). An error's `name`
is its constructor's, unless a class sets its own. `error(code, message)`
from `lucent:core` makes an `Error` with a `code`, which `errorCode(e)`
reads. A caught value is `unknown`: narrow it with `instanceof` or
`as Error`.

In Lucent code `e.stack` is `undefined` unless the error came from
JavaScript: native code records the site that made an error, not a stack.
`new Error(message, { cause })` is `LUCENT1003` ([T106](tasks.md#t106)),
and `AggregateError` `LUCENT2002` ([T103](tasks.md#t103)). The runtime
throws `TypeError`, `RangeError` and `SyntaxError` where JavaScript
would, and `Error`s named `AbortError`, `InvalidStateError`,
`DataCloneError` and `QuotaExceededError` for the web's exceptions.

`using` runs its value's `[Symbol.dispose]()` however the block is left,
in reverse order, skipping `null` and `undefined`. A disposal that throws
while an error is pending throws a `SuppressedError` of both. `await
using`, and `using` directly in a `case` clause, are `LUCENT1001`. The
editor needs `esnext.disposable` (or `esnext`) in tsconfig's `lib`, which
Expo's base config has and React Native's lacks.

## Generators and iterables

Generator functions, methods and expressions work with `yield`, `yield*`
and `return;`, lazily: a body runs on the first `next()`. `for…of`,
spread and `Array.from` take generators, arrays, sets, maps, strings,
byte views and `Iterable<T>` parameters. Leaving a `for…of` early runs
the generator's `finally` blocks.

The value of `yield` and returning a value are `LUCENT1001`, an
iterator's `throw()` `LUCENT1003`, and async generators `LUCENT2002`
([T106](tasks.md#t106) lifts these). A class can't define `[Symbol.iterator]`: write
a generator method. Generators don't cross to JavaScript (`LUCENT2006`).

## Async functions and microtasks

An `async` function is a C++20 coroutine returning `lucent::Promise<T>`
(`async.h`), and its body starts at once. An `await` of a promise
suspends, and the coroutine resumes from the microtask queue of the
context it started on, never inline. A promise belongs to the context
that made it, and a settlement from another thread is posted there.

An async function without an `await` allocates no frame and settles
before it returns (`eagerAsync` in `ir/cpp.ts`); what awaits it still
resumes later. A context's turn runs one job, then its microtasks
(`execution.h`), and `Promise.all` observes every input at once.

**Known gaps in the microtask order.** Two forms settle sooner than in
JavaScript, which reorders interleaved async code
([T103](tasks.md#t103)); `await delay(0)` yields meanwhile.

- `await` of a value that isn't a promise (`await 0`) doesn't suspend
  (`awaited` in `ir/lower.ts`); JavaScript waits one microtask.
- `return p` of a promise is lowered as `return await p`. When `p` has
  already settled, JavaScript settles one microtask later than that.

`new Promise(executor)` runs the executor at once; `resolve` takes a value
and `reject` an `Error`, and `resolve(promise)` is `LUCENT2002`.
`Promise.resolve`, `reject`, `all` (an array of one type, or a tuple) and
`withResolvers` work. `then`, `catch`, `finally`, `race` and `any` are
`LUCENT1003`, and `allSettled` fails on its result type (`LUCENT2002`)
([T103](tasks.md#t103)). Awaiting an optional promise is `LUCENT1001`.

There are no timers ([T104](tasks.md#t104)): `delay(ms, signal?)` waits
on the calling context. `await` of an SDK object is `LUCENT1010`, since
Lucent never picks a completion API by a class's name.
`fromCallback(register, signal?)` adapts a listener into a promise, and
`subscribe(register, onValue, signal?)` into a stream. Neither knows the
API: `register` starts listening at once and may return the cleanup that
stops it.

- The first of the callbacks (`resolve` or `reject`; `end`, `fail` or a
  throwing `onValue` for a subscription) and the signal's abort settles
  it. Later callbacks do nothing. An abort rejects `fromCallback`'s
  promise with its reason, and resolves a subscription's.
- The cleanup runs exactly once, inside the call that settles and before
  any continuation, or right after `register` returns if it settled
  during registration. A cleanup that throws is reported as uncaught.
- A throw from `register` rejects the promise, unless it had settled. An
  already-aborted signal settles it, and `register` isn't called.
- The callbacks may come from any thread. They take effect on the thread
  that called `fromCallback` or `subscribe`, in the order they came.

**Cancellation.** `AbortSignal` has `aborted`, `throwIfAborted()` and
`addEventListener("abort", f)`; `AbortController` has `signal` and
`abort(reason?)`, whose reason is an `Error` in Lucent (`LUCENT1003`).
`signal.reason` has no type: reading it gives `LUCENT2001`, or
`LUCENT1003` inside an expression. Catch the error instead.
`abort()` without a reason gives `AbortError: signal is aborted without
reason`, as React Native and browsers do. A non-object reason from
JavaScript becomes an `Error` with `String(reason)` as its message.

## Built-ins

Each built-in runs as native code and behaves as JavaScript defines it,
or the compiler refuses it with `LUCENT1003`
([decision 0045](decisions/0045-a-built-in-is-exact-or-refused.md)), as
it refuses an argument Lucent can't honor, such as a locale.
`emit/builtins.ts` is the inventory: a member it doesn't name is refused.

| Built-in      | Supported                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------- |
| `Math`        | every function and constant                                                                   |
| `Number`      | `isInteger`, `isSafeInteger`, `isFinite`, `isNaN`, `parseInt`, `parseFloat`, constants        |
| numbers       | `toString(radix)`, `toFixed`, `toPrecision`, `toExponential`, `valueOf`                       |
| globals       | `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `String`, `Number`, `Boolean`, `BigInt`        |
| `BigInt`      | `asIntN`, `asUintN`; `toString(radix)`, `valueOf`                                             |
| `String`      | `fromCharCode`, `fromCodePoint`; every method but `normalize` and the HTML ones (`anchor`)    |
| `Array`       | `from` (an iterable or `{ length }`), `of`, `isArray`                                         |
| arrays        | every method but `flat`, `copyWithin` and `toLocaleString`; `unshift` takes one item          |
| `Map`         | every method; `Map.groupBy`                                                                   |
| `Set`         | every method but `entries`                                                                    |
| `Object`      | `keys`, `values`, `entries` (records), `fromEntries`, `groupBy`                               |
| `Uint8Array`  | `subarray`, `slice`, `fill`, `indexOf`, `includes`, `set`, `forEach`, `map`, `reduce`, `join` |
| `ArrayBuffer` | `new ArrayBuffer(length)`, `byteLength`, `slice` (a copy)                                     |
| `Date`        | `now`, `parse`, `UTC`; the `get…`, `set…` and `to…String` methods but `toLocale…`             |
| `JSON`        | `parse` into a type; `stringify` of one value                                                 |
| `Promise`     | `resolve`, `reject`, `all`, `withResolvers`                                                   |
| `console`     | `log`, `info`, `debug`, `warn`, `error`                                                       |

`BigInt(x)` takes a number (`RangeError` unless an integer), a string
(`SyntaxError` unless an integer literal), a boolean or a bigint.
`Number(x)` of a bigint rounds to the nearest double, ties to even.
`console` writes a line to the unified log (prefix `[Lucent]`) or logcat
(tag `Lucent`): an object prints as `String(obj)`, a bigint with its `n`.

`toUpperCase` and `toLowerCase` use the root locale's full Unicode
mappings (`scripts/gen-unicode.ts`). `localeCompare`,
`toLocaleUpperCase` and `toLocaleLowerCase` use the device's locale as
Hermes does: CoreFoundation on iOS,
`java.text.Collator` and `java.lang.String` on Android. Their `locales`
and `options` arguments, and `normalize()`, are refused: Lucent has no
`Intl` data or normalization tables.

`sort` is stable, and compares strings without a comparator. `keys()`,
`values()` and `entries()` of arrays, maps and sets return arrays of the
contents at the call, where JavaScript returns live iterators. A
`Uint8Array` also has `length`, `byteLength`, `byteOffset` and `buffer`,
and its `reduce` needs an initial value. Its other methods are refused
(`LUCENT1003`), `ArrayBuffer.isView` gives `LUCENT1001`, and resizable
buffers are refused; [T100](tasks.md#t100) adds the methods with the other
typed arrays. `flat` and `copyWithin` are [T106](tasks.md#t106).

**Regular expressions** take every ECMAScript feature and flag
(`dgimsuvy`), compiled by QuickJS's libregexp, with `lastIndex`, `match`,
`replace` and `split` as specified (`regexp.h`). A replacement function
needs a `RegExp` pattern, and one with capture parameters a literal one.
A capture typed `string` throws `TypeError` if its group didn't
participate, and a pattern nested past the stack throws `SyntaxError`.

**JSON.** `JSON.parse(text) as T` builds a `T` of plain data: numbers,
strings, booleans, `null`, arrays, tuples, records, object types, and
unions that JSON kinds or a string-literal discriminant tell apart. A
mismatch throws `TypeError` naming the path (`expected a number at
.items[2].price, got a string`); revivers and class targets are refused.

`JSON.stringify` takes no replacer or indent ([T106](tasks.md#t106)), and
throws `TypeError` on a bigint. A class instance writes every field
JavaScript creates on it, `private` ones too, base fields first, never `#`
fields, statics or accessors. A `toJSON()` method's value replaces the
fields; one with parameters, or `async`, is `LUCENT1005`.

**Dates** take local time from the C library's time zone database, and
`toString()` has no zone name, as in Hermes:
`Mon Jul 22 2019 15:51:50 GMT-0700`. Not available yet: `TextEncoder`,
`TextDecoder`, `atob`, `btoa`, `URL` and `crypto` ([T105](tasks.md#t105)).
Not planned: `Symbol()`, `Proxy`, `Reflect`, `eval`, `new Function`, `Intl`.

## Modules

A module imports the app's other `*.lucent.ts` files, modules of the
Lucent packages the app depends on, and `lucent:` modules: `lucent:core`,
`lucent:thread`, `lucent:platform`, `lucent:ui` and the SDKs. A value
import from anything else is `LUCENT3001`, but `import type` works from
anywhere. A namespace import reads the module's exports, and isn't a
value itself (`LUCENT1001`).

A module's name is its file name without directory, platform suffix and
`.lucent.ts` (in a package, its path under the sources), unique in the
app (`LUCENT3010`). Export lists, re-exports and default exports are
`LUCENT3003`: JavaScript would see `export default function f` as
`default`. JavaScript sees exported functions, classes, enums (as frozen
objects), constants, `let`s and emitters.

An exported `let` is a live binding, as in an ES module
([decision 0041](decisions/0041-an-exported-let-is-a-live-binding.md)).
A variable holding an object, array, map, set, record, tuple or byte view
reaches JavaScript as a copy, one per value assigned, so
`mod.config === mod.config`. Changes inside that value don't reach
JavaScript: assign a new value, or export a function that returns it.

The top level holds declarations only (`LUCENT3002`), which initialize in
source order, a class's statics where it is declared. A module's top
level is its create hook. It runs at the first use of any module, a
JavaScript runtime's install today, and again at the first use after the
state ended. The state ends when the last live runtime goes (a reload)
while nothing native holds it; a runtime that installs while it lasts
shares it (`native_root.h`,
[decision 0090](decisions/0090-module-state-resets-only-when-nothing-native-holds-it.md)).
`onDestroy(hook)` from `lucent:core` runs when the state ends, last
registered first. No entry point runs module code without a JavaScript
runtime yet ([T130](tasks.md#t130)).

## Platform code

A shared module imports both platforms' SDKs (`lucent:ios/*`,
`lucent:android/*`) and branches on `PLATFORM` from `lucent:platform`:
`if (PLATFORM === "ios") { … } else { … }`, or `?:`. Each platform
compiles its own branch, and the top-level declarations that use its SDK.
An SDK used outside its platform's code is `LUCENT3004`. This is the
standard way to write platform code.

The alternative, for halves that share nothing, is
`<name>.ios.lucent.ts` and `<name>.android.lucent.ts` implementing what
`<name>.lucent.ts` declares (`LUCENT3005` when they differ). The
declaration file holds declarations, types, imports and shared constants
and enums, but no class yet ([T106](tasks.md#t106)). The rules are in
[platform-bindings.md](platform-bindings.md); a web platform is
[T144](tasks.md#t144).

The compiler checks what TypeScript can't: a main-thread-only API outside
`main(() => …)` (`LUCENT3006`), and an API newer than the app's oldest OS
without `available()` or an `SDK_INT` check (`LUCENT3007`). It warns for
an Android constant outside its group (`LUCENT3008`), a `@WorkerThread`
call on the main thread (`LUCENT3009`), and a misspelled delegate method
(`LUCENT3013`).

**Native integers.** Java's `long`, Kotlin's `Long`, `int64_t`,
`uint64_t`, `NSInteger`, `NSUInteger` and Swift's `Int`, `Int64` and
`UInt64` are `bigint`s ([decision 0008](decisions/0008-every-native-64-bit-integer-is-a-bigint.md)):
`list.count` is `3n`. Every value read is exact, `NSNotFound` and
`Long.MAX_VALUE` included, and a bigint passed in that doesn't fit throws
`RangeError` naming the parameter or field.

A method's or function's own 64-bit parameter also takes a safe-integer
number, not negative for an unsigned one; another number throws
`RangeError` (`ms of Thread.sleep: 1.5 is not a safe integer`,
[decision 0070](decisions/0070-64-bit-parameters-take-safe-integer-numbers.md)).
Enums, option sets and `@IntDef` or `@LongDef` groups stay numbers. A
number passed as a narrower integer converts as WebIDL's default
conversion does (`number.h`): NaN and infinities become 0, and the rest
truncates and wraps.

**Native errors.** An error a platform call throws is an `Error` whose
`code` names it: `"NSCocoaErrorDomain:260"`, or a Java exception's class
name. `nativeError(e)` from `lucent:ios` or `lucent:android` gives back
the native error, and `errorOf(throwable)` makes one from a callback's
`Throwable` ([decision 0069](decisions/0069-native-errors-stay-errors-with-their-source-kept.md)).
Platform objects compare by identity and stay in Lucent (`LUCENT2006`),
as typed C extensions' handles (`lucent:ext/…`) do; C++ headers and
extension callbacks are [T142](tasks.md#t142).

## Crossing the JavaScript boundary

`lucent_bindings.cpp` (`emit/bindings.ts`) gives each type that crosses a
`Convert` from `runtime/cpp/lucent/jsi/convert.h`. Conversions run on the
JS thread, holding the module's actor.

| Kind                                                     | How it crosses                                           |
| -------------------------------------------------------- | -------------------------------------------------------- |
| numbers, strings, booleans, `undefined`, `null`, bigints | as values; bigints exactly, at any size                  |
| arrays, tuples, records, maps, sets, plain objects       | copies, both ways                                        |
| `Uint8Array`, `ArrayBuffer`                              | copies, but for the moves and loans below                |
| `Date`; `RegExp`                                         | a copy of the time; a new `RegExp`, `lastIndex` lost     |
| class instances, interface values                        | the same object each time                                |
| an object literal for an interface                       | a plain object, a copy                                   |
| functions; promises                                      | callbacks both ways; JS promises out, Lucent promises in |
| `Iterable<T>` arguments                                  | a snapshot (`Array.from`), iterated lazily               |
| `AbortSignal`                                            | into Lucent only: one native signal per JS signal        |
| `EventEmitter`, `NativeBuffer`, `NativeHandle`           | the same opaque object each time                         |
| `JSValue`                                                | JavaScript's value, handed back as itself                |

`LUCENT2006` refuses generators and iterators or an `AbortSignal` going
out, `AbortController`, platform objects, extension handles, the weak
types, `FinalizationRegistry`, `Channel`, byte spans, and match and
iterator results. Generic classes and values are `LUCENT2007`, and object
unions without a discriminant `LUCENT2005`.

### Copies, moves and loans

Arrays and objects copy at the boundary: JavaScript's objects belong to
the JS thread, and Lucent runs on others. Inside Lucent they are shared.
Each exception is explicit:

- **Move out.** An `ArrayBuffer`, or a `Uint8Array` viewing all of one,
  that a function returns and nothing else holds moves: JavaScript gets
  the same bytes, adopted ones included. The copy would be the only one.
- **Loan in.** A synchronous export that only reads a `Uint8Array` or
  `ArrayBuffer` argument reads JavaScript's bytes in place while it runs,
  so a write JavaScript makes meanwhile shows. Bytes a function writes,
  keeps, returns, captures or passes on to its own code are copied, as
  are an async function's and an optional argument's.
- **`NativeBuffer`.** JavaScript never gets memory a worker may be
  writing: its `withRead` and `withWrite` lend it a copy, copied back
  after `withWrite`. `transferToArrayBuffer()` moves the bytes, uncopied.

### Identity and checks

The same instance always maps to the same JavaScript object, which lives
while either side holds it. An exported class is a constructor for `new`
and `instanceof`, with its own and its Lucent bases' statics on it. Public
fields are prototype accessors, a `readonly` one without a setter, so
`Object.keys` and `JSON.stringify` in JavaScript see no fields.

A static field is a property over the native one, so the module sees
JavaScript's writes. Assigning one a class inherits writes the base's
field, where JavaScript gives the subclass its own. A package's exported
types are one type in every package that imports it.

Arguments are checked against their types
(`midpoint: argument 'a'.y must be a number, got undefined`), the path
rendered only on failure. A synchronous export throws the `TypeError`,
and an async one rejects with it. Interface values must be instances of
Lucent classes that implement the interface.

`null` and `undefined` are told apart for an argument, a setter's value or
an object's field: `T | undefined` rejects `null`, and `T | null` rejects
`undefined`. Inside arrays, maps, sets, records, tuples, callback results
and promise values either is taken, and code that narrows it to `T` throws
`TypeError`: a known gap ([T101](tasks.md#t101)).

### Callbacks, promises and events

A JavaScript function Lucent holds runs synchronously when called on the
JS thread during a call from JavaScript, and may return a value. From any
other thread it is posted, so it returns `void` (a throw goes to the log)
or a `Promise`. Calling one that returns another value from another
thread throws an `Error`. Lucent code
never waits for the JS thread. A Lucent function given to JavaScript
enters the actor it was made on, and a Lucent promise reaches JavaScript
as a JS promise, settled and converted on the JS thread.

`EventEmitter<Events>` from `lucent:core` names each event and its void
listener; in Lucent an event's name is a string literal (`LUCENT1007`).
`emit` calls the listeners the event has when it starts, in order, and a
listener's throw ends it. The emitter crosses as one object. A listener
JavaScript adds runs at once on the JS thread, or posted with copies of
its arguments, and a reload removes it. From JavaScript, an undeclared
event throws `TypeError`. `onObserved(name, observer)` hears an event's
first listener come and its last one go.

### Errors and codes

An instance of a Lucent class that extends `Error` crosses as itself:
thrown, returned or made with `new` in JavaScript, it is `instanceof` its
class and `Error`, with its fields. From JavaScript its `name` and
`message` take strings only, and `Object.prototype.toString` gives
`[object Object]`, since it only inherits `Error.prototype`. A subclass no
export's types reach crosses as an `Error` with its name and message.

Every other error crosses as a new JavaScript error each time: an
`Error`, `TypeError`, `RangeError` or `SyntaxError` with its `name`,
`message` and `code`. Its `stack` starts with the Lucent frame that made
it (`at parse (src/config.lucent.ts:12)`, relative to the project). An error JavaScript
throws into Lucent keeps its `name`, `message`, a string `code` and its
`stack`, but not its identity or other fields; a thrown non-Error becomes
an `Error`. An uncatchable error goes to the platform log and stderr.

### JSValue

A `JSValue` is a JavaScript value Lucent holds without reading it. It is
stored, passed on and handed back as the same value: an object keeps its
identity, and a function stays callable. The host releases it on the JS
thread with the last Lucent reference, and one held across a reload
throws `TypeError` when it goes back. Comparing (but with `undefined` or
`null`), converting, testing, `typeof`, JSON and keying with one are
refused (`LUCENT1002`, `1003`, `2002`), and so is a compute task taking
one (`LUCENT3012`).

A `NativeBuffer` and a `NativeHandle` cross as opaque objects, the same
one each time; their rules are under [Interop](#interop).

### Build identity

Each compile gives the app binary and the JavaScript bundle an identity
(`emit/identity.ts`): the runtime ABI, a program hash per target and an
API hash per module. Before a module loads, a different ABI, React Native
release or API is an error with `code: "LUCENT_NATIVE_MISMATCH"`; another
program with the same APIs warns once ([architecture.md](architecture.md#build-identity)).

## Interop

Lucent shares bytes and addresses with other native code without
copying them, and tells JavaScript's collector what native memory its
objects hold.

### Native buffers

A `NativeBuffer` is bytes native code owns, reached through a borrow for
one call (`buffer.h`): `withRead` lends a `ByteSpan`, and `withWrite` a
`MutableByteSpan` that needs the buffer to itself. A conflicting borrow,
close or transfer throws `InvalidStateError` at once, and a span that
escapes its callback is `LUCENT3030`. After `transfer()` moves the bytes,
the old buffer throws (`LUCENT3031` where the compiler sees it).
`close()` or `using` releases them; `from` and `toUint8Array()` are the
only copies, which `stats()` counts.

Platform memory becomes a buffer without a copy where the platform lends
it: `adoptByteBuffer` in `lucent:android` adopts a direct `ByteBuffer`,
which Java must leave alone after. `adoptPixelBuffer` in `lucent:ios` and
`adoptHardwareBuffer` in `lucent:android` adopt a frame's plane, locked
for reading until released, or for writing too with `"readwrite"`. Bytes
adopted for reading are read-only: a write, from Lucent or JavaScript,
and `transferToArrayBuffer()` throw `InvalidStateError`, since an
`ArrayBuffer` is writable, and a move keeps them so. `withPixelBytes` is
the copying form. An `NSData` isn't adopted: Swift's `Data` crosses as a
`Uint8Array` copy
([0086](decisions/0086-platform-memory-is-adopted-read-only-unless-asked.md)).

### Native handles

A `NativeHandle` is an address held valid until released: `pointer` (a
bigint, `0n` once released), `released` and `release()`, once, from either
side and any thread. A buffer's `handle()` borrows its bytes for read
until then. One whose last reference goes unreleased is released then; a
debug build counts those JavaScript collected (`host.releasedOpen` in
`__lucentDebug.snapshot()`). `retainedHandle(object)` in `lucent:ios`
retains an object (+1) until released; `handleOf` in `lucent:android`
holds a direct `ByteBuffer` (a heap one is a `TypeError`) or acquires a
`HardwareBuffer`.

A reload starts module state again, so a handle or buffer only it held
is released with its last reference; the old runtime's objects go with
it. A runtime that gets a new host and keeps its JavaScript, as the e2e
host's `__lucentReplaceHost` does, finds that a buffer, handle or class
instance of the old host throws `TypeError` when used.

### Memory pressure

A `NativeBuffer`, and an instance of a class implementing `NativeSized`
from `lucent:core`, report the native memory they hold to JavaScript's
collector
([0084](decisions/0084-a-class-states-its-native-size-by-implementing-nativesized.md)).
`nativeSize`, a field or a getter, is read holding the module's actor:
when the instance crosses to JavaScript, and after each method or setter
JavaScript calls on it. A change module code makes alone shows at the
next crossing. A buffer reports nothing once moved or closed, and a size
past 32 bits reports as the most Hermes takes.

## Concurrency

Lucent code runs one piece at a time per actor, like JavaScript, so a
module never races with itself (`scheduler.h`,
[decision 0064](decisions/0064-an-actor-per-package-and-the-main-thread-never-queues.md)).
An actor is an import component, usually a package or the app's own
modules: the modules that import one another, type-only imports included
(`emit/actors.ts`). Each has a lock and a thread, shares no objects with
another, and runs in parallel with the others.

Every entry into a module holds its actor's lock: a synchronous call from
the JS thread, a job on the actor's thread, or a platform callback. A
synchronous export runs on the JS thread. An async one starts on its
actor's thread, and its awaits interleave with the actor's other async
work as in JavaScript. A synchronous call into an actor waits for a long
async job's next `await`, so keep synchronous exports short.

### The main thread and platform callbacks

The main thread never queues behind module jobs. `main(f)` from
`lucent:thread` runs `f` there once its actor is free, holding it, and
resolves with its result; `present()`, `onAppEvent` and `onSceneEvent`
run the same way. Android's `onActivityEvent` runs its handler in a turn
of the calling context, but a `"backPressed"` handler runs on the main
thread while Android waits for whether it consumed the press, the first
that does ending it.

`onAppEvent`'s app-delegate events ("openURL", "userActivity",
"shortcutItem", "pushToken", "pushTokenFailed", "remoteNotification",
"backgroundFetch", "backgroundURLSession",
"supportedInterfaceOrientations") come from `LucentAppDelegate`, which
the app's delegates call (`ios_app_delegate.mm`). A listener that answers
runs while UIKit waits, and the modules' answers merge: a URL, activity
or shortcut is handled if any module handled it, a fetch has new data if
any had some, else failed if any failed, and the orientations are those
every module that answered allows. A fetch's answers come by a promise,
and iOS hears them after 25 seconds at the latest. A URL, activity,
shortcut or push token that comes before any subscriber waits for the
first one (`delegate_events.h`).

A platform callback that must answer now (a delegate's result) waits only
for the code holding the actor, ahead of queued entries; a debug build
logs a wait past 50 ms. A synchronous call running a JavaScript callback
lends its actors to the main thread, so JavaScript that waits for the
main thread there can't deadlock it.

Other platform callbacks enter module code under their actor's lock, so
a frame delegate waits behind synchronous JavaScript calls;
`serialQueue(label)` from `lucent:ios` only moves them off the main
thread. A function or a delegate can go on an executor instead (below).
Worklet runtimes can't call Lucent yet ([T134](tasks.md#t134)).

### Compute tasks

`compute(task, input, options?)` runs `task(input)` on a pool of workers,
which never take an actor's lock, and resolves on the calling context
(`compute.h`). The pool has a worker fewer than the cores (at least one)
and queues 1,024 tasks, then rejects with `QuotaExceededError`.

`task` is a top-level function of one parameter (`LUCENT1007` for a
closure). It reads no module state or computed constant, runs no
main-thread native code or async work, and calls only code the compiler
can follow (`LUCENT3011` names the cause). Its input and result are data
(`LUCENT3012`): no functions, promises, signals, `JSValue`s or handles.

The input is copied when `compute` is called (`transport.h`): what is
reached twice is copied once, and cycles survive. A `NativeBuffer` moves
(a borrowed one rejects), and a subclass instance behind a base type
throws `DataCloneError`, since its copy would lose fields. The result
comes back as it is.

Aborting `options.signal` rejects at once, and a queued task never
starts. A running task stops at its next safepoint, a loop's back edge in
it or in a module function it calls; other code runs to its end.
`lucent:core`'s JavaScript `compute` differs in three ways
([limitations.md](limitations.md)).

### Executors

`executor(label)` from `lucent:thread` makes a serial context of its own
that never takes an actor's lock (`ExecutorContext`): a serial dispatch
queue on iOS, and on Android a thread that a `java.util.concurrent.Executor`
posts to. An SDK parameter that takes a queue or an `Executor` takes it
as it is. `label` is the queue's or the thread's name.

`on(executor, f)` hands a function literal to the platform as an SDK
call's argument (a block, a Java functional interface, a Kotlin
function), and only there (`LUCENT1007`). It may also be a `const` in a
function's body, each use of which is such an argument or an SDK
property's value: wherever it goes, it is one platform object, so a
listener added with it is removed with it
([0085](decisions/0085-a-const-keeps-one-platform-object-of-an-executor-callback.md)).
When the platform calls `f` on
the executor, `f` runs there at once, in its context; called from any
other thread, an `f` returning nothing runs in a turn of the executor,
and one returning a value is reported as a callback's error is, the
platform getting a default result. Its microtasks run before it returns.

`f` runs beside module code, so the compiler checks it as a compute task
(`LUCENT3032`), except that native code of unknown thread is allowed.
Main-thread native code, module state and computed constants, code the
compiler can't follow and asynchronous work are refused, and so is an
`async` `f`. It captures only `const` numbers, strings, booleans,
bigints, `null` and `undefined`, channels and executors: a `let`, or an
array, object or native object its maker could change, is refused. What
it makes leaves through a `Channel`
([0081](decisions/0081-functions-on-an-executor-share-only-constants-and-channels.md)).

An object goes on an executor where it is made, as an SDK call's
argument or an SDK property's value, or in a `const` as a function does:
`parser.delegate = on(frames, new Collector(out))`. Its class is then
an executor class: every `new` of it is such an `on()`, it isn't
exported and neither extends nor is extended, and `this` in it is only a
member access's receiver, so nothing but the platform's calls reaches
the object. Its constructor takes what a function's captures may be,
and its methods are checked as `f` is. The platform's calls of them
enter the executor as `f`'s do
([0082](decisions/0082-objects-go-on-an-executor-where-they-are-made.md)).

An `EventEmitter` is shared too, captured as a `const` or given to an
executor class's constructor, and a `const` of a shareable value may
name module state: `const ev = events` lets `f` emit on a module's
exported emitter. An `emit` written in `f`, in an executor class's
methods or in a closure in them copies its arguments and emits in a turn
of the emitter's module, which runs its listeners, Lucent's and
JavaScript's; nothing else on an emitter is called there, and an `emit`
in a helper they call is refused as code that runs listeners
([0083](decisions/0083-code-on-an-executor-emits-through-emitters-it-holds.md)).

Code an executor may run (`f`, an executor class's methods, and the
functions they call) hands the platform its own callbacks and objects
with `on()` as well. A function it hands over without `on()` runs in its
module when the platform calls it, beside the executor, so it is refused
if it captures what `f`'s rule refuses or uses `this`; an object it
hands over without `on()` is refused.

### Channels

`new Channel<T>(policy, capacity?)` carries values from a producer on any
thread to a consumer on its own context (`channel.h`). A send never
waits: into a full channel, `"lossless"` refuses it (`false`), `"latest"`
replaces the one value, and `"drop"` drops the oldest. The capacity is a
whole number from 1, 16 by default and 1 for `"latest"`.

`send` copies as `compute` does (a `NativeBuffer` moves), and what is
dropped or never received is released. `receive()` settles on the asking
context with the next value, or `undefined` once closed and drained, and
`subscribe(onValue)` delivers values one at a time. A channel crosses to
a task or an executor's function, which can't receive (`LUCENT3011`, `LUCENT3032`),
but not to JavaScript.

### Deadlocks and runtimes

A module reaches another actor only through JavaScript or the platform,
holding both actors, nested. A nested wait that would close a cycle throws
an `Error` starting `Lucent: deadlock` instead of hanging. Work module
code starts (an async call, a delay, a task) belongs to the runtime whose
call started it, and tearing a runtime down cancels its work only. Module
variables are the process's: a second live runtime shares them, and a new
`Host` resets them only while no other runtime is live.

## Memory

Objects, arrays, closures and instances are reference counted
(`core.h`). No collector runs, so a cycle of strong references is never
freed: a parent and child that point at each other, or a closure stored
on the object it captures. Break the cycle by clearing a field, hold the
back reference through a `WeakRef`, or key one side in a `WeakMap`.

A debug build names each cycle it finds at a teardown, once, in the
platform log (`refs.h`). It lists the fields that close it, and names the
last as the one to hold weakly. The next runtime writes each as a
`console.warn`, and `__lucentDebug.snapshot()` lists them as `cycles`.
JavaScript's collector sees the native memory a `NativeBuffer` or a
`NativeSized` instance holds ([memory pressure](#memory-pressure)).

`new WeakRef(target)` holds a class instance, interface value or object,
freed with its last strong reference: `deref()` then gives `undefined` at
once. `WeakMap` and `WeakSet`, keyed by the same kinds, have `get`, `set`,
`has`, `delete` and `add`, and no iteration or `size` (`weak.h`,
[decision 0072](decisions/0072-weakmap-and-weakset-drop-entries-with-their-keys.md)).
An entry goes at once with its key, its value with it, but a value that
holds its own key keeps it. SDK objects as targets or keys are
[T112](tasks.md#t112).

`new FinalizationRegistry(cleanup)` takes `register(target, held, token?)`
and `unregister(token)`. Once a target goes, each registration's cleanup
runs with its held value, as a job of the registry's context after the
turn that freed it. None of the weak types crosses the boundary.

### Stack checks

A Lucent call is a native call, so recursion uses the native stack. Each
function that calls program code checks it on entry, in release builds
too (`stack.h`, [decision 0073](decisions/0073-every-call-checks-the-stack-in-release-too.md)).
With less than a margin left (64 KB, or a quarter of a small stack), it
throws `RangeError: Maximum call stack size exceeded`, which code
catches. An `async` function's check rejects its promise.

Lucent's own threads have 8 MB stacks (`kThreadStackSize` in
`execution.h`); the JS and main threads have the platform's, and a
synchronous export recurses on the JS thread's. So the limit depends on
the thread and the frames' sizes, not on a number of frames.

## Deviations from JavaScript

Each row matches a row of `apps/website/src/docs/language.ts`, which
names the e2e cases around it. A deviation found in code gets a row in
both, in the same commit.

### Arrays, collections and memory

| JavaScript                                         | Lucent                                                 | Why                                       |
| -------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `arr[i] = v` past the end leaves holes             | `RangeError`; append with `push` or at `length`        | an array has no holes                     |
| `arr[-1] = v` and `arr[1.5] = v` add a property    | `RangeError`                                           | an array has elements only                |
| a larger `length` leaves holes                     | `RangeError`                                           | an array has no holes                     |
| `new Array(n)` has `n` holes                       | refused unless `.fill(v)` follows (`LUCENT1003`)       | the element type may lack `undefined`     |
| `x!` does nothing at run time                      | `TypeError` on an absent value                         | the assertion is checked where it is made |
| `x as T` does nothing at run time                  | taking a member out of a union checks it               | a variant holds one member's layout       |
| `keys()`, `values()`, `entries()` return iterators | arrays of the contents at the call                     | an array serves wherever they are read    |
| the collector frees cycles                         | reference counting never does                          | no collector runs                         |
| a `WeakRef` target lives until the collector runs  | freed with its last strong reference                   | a count reaches zero at once              |
| a weak entry lives until the collector runs        | it goes with its key; a value holding its key keeps it | nothing traces through a value            |
| a finalization cleanup runs later, or never        | soon after, as a job, every time                       | a count reaches zero at once              |
| deep recursion throws at the engine's frame limit  | `RangeError` when the native stack is nearly full      | each call checks the native stack         |

### Objects, comparisons, strings, JSON and dates

| JavaScript                                             | Lucent                                                 | Why                                         |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------- |
| keys come in the order they were added                 | an object type's one fixed order; use a record         | objects of a type share one layout          |
| `Object.keys`, `for…in` and `in` see an object's keys  | refused on object types (`LUCENT1003`, `1009`, `1002`) | a layout records neither presence nor order |
| `{ b: undefined }` has a key `b`                       | an unset field: left out of JSON and the boundary      | a field is set or unset                     |
| `==` converts first (`1 == "1"`)                       | refused (`LUCENT1002`): convert, then use `===`        | `==` compiles where nothing converts        |
| functions compare by reference                         | refused (`LUCENT1002`, `LUCENT2002`)                   | a function value has no stable identity     |
| tuples are arrays, compared by reference               | values: `===` compares elements                        | a tuple is a fixed-size value               |
| two `subarray()` views of one range differ             | they are one view                                      | a view is a buffer and a range              |
| `console.log(obj)` shows its structure                 | prints `String(obj)`                                   | the platform log takes text                 |
| `split(regexp)` inserts `undefined` for a missed group | inserts `""`                                           | the result is a `string[]`                  |
| `JSON.parse` returns whatever the text holds           | the text must match the type, or `TypeError`           | the value is built in its type's layout     |
| `JSON.stringify` keeps parsed text's key order         | keys follow the type's order                           | an object type has one order                |
| `date.toString()` names the zone in some engines       | Hermes's form; `toLocale…` refused                     | Lucent follows Hermes, and has no `Intl`    |

### The boundary

| JavaScript                                          | Lucent                                                  | Why                                        |
| --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| type annotations are erased                         | arguments are checked: `TypeError` before the code runs | a native value needs its layout            |
| an exported `let` holding an object is the object   | read live, each value assigned copied once              | values copy at the boundary                |
| an `EventEmitter` takes any event name              | from JavaScript, declared names only: `TypeError`       | events are numbered when compiled          |
| arrays and objects passed on are shared             | copied; shared inside Lucent                            | JavaScript's objects stay on the JS thread |
| a `Uint8Array` or `ArrayBuffer` passed on is shared | copied; a read-only sync call reads them in place       | bytes only read need no copy               |
| a `RegExp` passed on is shared                      | a new `RegExp`: identity and `lastIndex` lost           | its state lives in native code             |
| code can read any value it is given                 | a `JSValue` is held, never read                         | only JavaScript reads its values           |
| `Date` objects passed on are shared                 | copied                                                  | as arrays and objects                      |
| a function returns its value whenever called        | off the JS thread, posted: `void` or `Promise`          | Lucent never waits for the JS thread       |
| an instance has its fields as own properties        | prototype accessors, no setter when `readonly`          | the fields live in native code             |
| `[Symbol.dispose]()` is callable from JavaScript    | not visible: add a `close()`                            | members cross by name; Hermes lacks it     |

### Errors, cancellation, classes and variables

| JavaScript                                                                                         | Lucent                                                                                                | Why                                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `error.stack` is a string                                                                          | `undefined` in Lucent unless from JavaScript                                                          | native code records a site, not a stack                      |
| `new Error(m, { cause })` keeps the cause                                                          | refused (`LUCENT1003`, [T106](tasks.md#t106))                                                         | an error is a name, a message and a code                     |
| `abort()`'s message depends on the engine                                                          | `AbortError: signal is aborted without reason`                                                        | one message on both platforms                                |
| an abort reason can be any value                                                                   | an `Error`; JavaScript's become errors                                                                | Lucent's errors are `Error` objects                          |
| `resolve(promise)` adopts the promise                                                              | refused (`LUCENT2002`; `LUCENT1007` in `fromCallback`)                                                | a promise settles with a value                               |
| `await` on an object without `then` gives it                                                       | refused on an SDK object (`LUCENT1010`)                                                               | no completion API is picked by name                          |
| an error object reaches JavaScript as itself                                                       | an exported error class's instance does; other errors are new, without their identity or extra fields | only an exported class keeps identity                        |
| JavaScript can throw any value                                                                     | a non-`Error` from a callback becomes an `Error` with `String(value)` as its message                  | Lucent catches errors only                                   |
| an error's `name` and `message` take any value; `Object.prototype.toString` gives `[object Error]` | from JavaScript, strings only (`TypeError` otherwise); `[object Object]` for a Lucent error class     | native strings; the instance only inherits `Error.prototype` |
| an uncatchable error reaches the host's handler                                                    | the platform log and stderr                                                                           | native code has no JavaScript handler                        |
| a field read before it's assigned is `undefined`                                                   | a value type's default; an object throws `TypeError`                                                  | a field holds a native value from the start                  |
| any object with the right members fits an interface                                                | `implements`, or a literal of a data-only interface                                                   | an interface with methods is a base class                    |
| assigning an inherited static gives a subclass its own                                             | from JavaScript it writes the base's field                                                            | a static is one native variable                              |

### Known gaps

| JavaScript                                                  | Lucent today                                                   | Task                  |
| ----------------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| `null` and `undefined` differ wherever they appear          | in containers, callback results and promise values either fits | [T101](tasks.md#t101) |
| a `let` read before its declaration throws `ReferenceError` | it reads as an unassigned field                                | [T106](tasks.md#t106) |
| `await` of a plain value waits one microtask                | doesn't suspend                                                | [T103](tasks.md#t103) |
| `return p` in an async function takes three microtasks      | one, as `return await p`                                       | [T103](tasks.md#t103) |

## Diagnostics

Every code of `packages/compiler/src/codes.ts`, which holds each one's
explanation and fix (`lucent explain LUCENTxxxx`): `1xxx` syntax, `2xxx`
types, `3xxx` modules and where code runs, `9xxx` passed through.

| Code         | Name                          | Meaning                                                                                  |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `LUCENT1001` | `UnsupportedSyntax`           | syntax outside the subset: `var`, literal accessors, `await using`, tagged templates     |
| `LUCENT1002` | `UnsupportedOperator`         | `delete`, `in` or `instanceof` where unsupported; a converting `==`; comparing functions |
| `LUCENT1003` | `UnsupportedBuiltin`          | a built-in, method or argument Lucent doesn't implement exactly                          |
| `LUCENT1004` | `UnsupportedDestructuring`    | object rest, computed keys, or another pattern outside the subset                        |
| `LUCENT1005` | `UnsupportedClassFeature`     | extending a built-in, a changed override signature, static blocks, decorators            |
| `LUCENT1006` | `UnsupportedThrow`            | throwing a value that isn't an `Error`                                                   |
| `LUCENT1007` | `UnsupportedCall`             | a call with no native form, such as spread into parameters                               |
| `LUCENT1008` | `UnsupportedAssignmentTarget` | assigning a function, an import, a tuple element or an unknown field                     |
| `LUCENT1009` | `UnsupportedLoop`             | a loop over a value Lucent can't iterate, or `for await`                                 |
| `LUCENT1010` | `AwaitNative`                 | `await` on a platform SDK object, which isn't a promise                                  |
| `LUCENT2001` | `AnyType`                     | `any`, or `unknown` outside `catch`                                                      |
| `LUCENT2002` | `UnsupportedType`             | a type with no native representation                                                     |
| `LUCENT2003` | `InexactObject`               | an object used as a type of another shape                                                |
| `LUCENT2004` | `ArrayVariance`               | a collection as another element type, or an instance as another instantiation            |
| `LUCENT2005` | `AmbiguousUnion`              | a union JavaScript values can't be told apart by: add a discriminant                     |
| `LUCENT2006` | `BoundaryType`                | a value that can't cross the JavaScript boundary                                         |
| `LUCENT2007` | `GenericBoundary`             | a generic function, class or value at the boundary                                       |
| `LUCENT2008` | `InterfaceNotImplemented`     | a value used as an interface its class doesn't declare                                   |
| `LUCENT2009` | `InterfaceMismatch`           | a member whose native signature differs from the interface's                             |
| `LUCENT3001` | `UnsupportedImport`           | a value import from outside Lucent and `lucent:` modules                                 |
| `LUCENT3002` | `UnsupportedTopLevel`         | a top-level statement, an overload, or a non-constant enum member                        |
| `LUCENT3003` | `UnsupportedExport`           | export lists, re-exports and default exports                                             |
| `LUCENT3004` | `SdkImport`                   | an SDK used where its platform can't be, or an SDK without bindings                      |
| `LUCENT3005` | `PlatformConformance`         | platform files that don't match their declaration file                                   |
| `LUCENT3006` | `MainThreadOnly`              | a main-thread-only API outside `main(() => …)`                                           |
| `LUCENT3007` | `Unavailable`                 | an API newer than the app's oldest OS, without a version check                           |
| `LUCENT3008` | `ConstantOutsideGroup`        | warning: an Android constant outside its `@IntDef` or `@StringDef` group                 |
| `LUCENT3009` | `BlockingOnMain`              | warning: a `@WorkerThread` member called on the main thread                              |
| `LUCENT3010` | `ModuleNameClash`             | two modules of one app with one name                                                     |
| `LUCENT3011` | `NotIsolated`                 | a compute task that touches module state, unfit native code or async work                |
| `LUCENT3012` | `NotTransferable`             | a compute task's input or result that isn't data                                         |
| `LUCENT3013` | `UnmatchedRequirement`        | warning: a method named like a protocol requirement that matches none                    |
| `LUCENT3014` | `IncompatiblePackage`         | a package whose `lucent.compatible` range leaves this Lucent out                         |
| `LUCENT3020` | `ComponentExport`             | an exported `.lucent.tsx` function returning a view that can't be a component            |
| `LUCENT3021` | `ComponentContract`           | a component prop, event or command views can't carry, or a reserved name                 |
| `LUCENT3022` | `ComponentMainThread`         | component code that can't run on the main thread                                         |
| `LUCENT3023` | `ComponentPlatforms`          | a component that differs between platforms or from its declaration                       |
| `LUCENT3024` | `ToolkitBody`                 | a SwiftUI or Compose body Lucent can't write out, or toolkit code outside one            |
| `LUCENT3025` | `NativeViewJsx`               | UIKit or Android view JSX its declarations don't provide for                             |
| `LUCENT3030` | `BorrowEscape`                | a span from `withRead` or `withWrite` that escapes its callback                          |
| `LUCENT3031` | `UseAfterMove`                | a `NativeBuffer` used after `transfer()` or `compute` moved it                           |
| `LUCENT3032` | `NotOnExecutor`               | code on an executor using module state, main-thread code, async work or shared values    |
| `LUCENT9001` | `TypeScript`                  | a TypeScript error: Lucent compiles only programs that type-check                        |
| `LUCENT9002` | `InternalError`               | a compiler fault, reported at its function instead of stopping the build                 |

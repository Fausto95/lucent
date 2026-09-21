# The Lucent language (v1)

Lucent is a constrained subset of TypeScript. A module is one `*.lucent.ts`
file. The compiler turns it into Swift and Kotlin ahead of time; nothing in the
file ever runs in a JavaScript engine. Everything TypeScript allows but Lucent
does not is rejected with a dedicated `NT` diagnostic, never with a generic
TypeScript error.

## Module shape

- `export function` and `export async function` declarations are the module's
  native API. Non-exported functions are private helpers.
- `type Name = { … }` aliases declare structs. They may be exported or not.
- The only permitted import is `import type { … } from "@lucent/types"`.
  Any other import is `NT1006 Unsupported dependency`.
- Nothing else may appear at the top level (no statements, no classes, no
  `const` declarations, no default exports). → `NT1001 Unsupported syntax`.

## Types

| TypeScript                                                              | Native type    | Swift               | Kotlin            |
| ----------------------------------------------------------------------- | -------------- | ------------------- | ----------------- |
| `number`                                                                | `float64`      | `Double`            | `Double`          |
| `string`                                                                | `string`       | `String`            | `String`          |
| `boolean`                                                               | `bool`         | `Bool`              | `Boolean`         |
| `void`                                                                  | `void`         | `Void`              | `Unit`            |
| `T[]`, `Array<T>`                                                       | `array<T>`     | `[T]`               | `List<T>`         |
| `T \| null`, `T \| undefined`                                           | `optional<T>`  | `T?`                | `T?`              |
| `Record<string, T>`                                                     | `map<T>`       | `[String: T]`       | `Map<String, T>`  |
| `Uint8Array`                                                            | `bytes`        | `ArrayBuffer`       | `ArrayBuffer`     |
| `Promise<T>` (return type only)                                         | `promise<T>`   | `async … -> T`      | `suspend …: T`    |
| object type alias                                                       | `struct`       | `struct`            | `data class`      |
| `int8…int64`, `uint8…uint64`, `float32`, `float64` from `@lucent/types` | sized numerics | `Int32`, `Float`, … | `Int`, `Float`, … |

Rules:

- A struct's fields may be any type above except `Promise`. Optional fields
  (`name?: T` or `name: T | null`) become `optional<T>`.
- `Promise<T>` is legal only as the declared return type of an `async` function.
  An `async` function must declare `Promise<T>`; a sync one must not.
- Unions other than `T | null` / `T | undefined` → `NT1003 Unsupported type`.
- `any`, `unknown` → `NT1004`. Function types → `NT1005`. `never`, `object`,
  `symbol`, `bigint`, tuples, generics, classes, interfaces, enums → `NT1003`.
- Optionals must be narrowed before use: `if (x === null) { … }` or
  `if (x !== null) { … }` on a local or parameter, including the early-return
  form. There is no truthiness: `if (x)` is `NT1011` unless `x` is a boolean.
- Numeric types never convert implicitly; `int32 + number` is `NT1011`. Integer
  literals adopt the sized type of their context.
- `await` outside an `async` function is a parse error (`NT1000`).
- A function may take at most 8 parameters → `NT1007 Too many parameters`.
- Parameters and return types must be annotated. Locals may be inferred from
  their initializer.

## Statements

`const`, `let`, `if` / `else`, `while`, `for (;;)`, `for … of` over an array,
`return`, `break`, `continue`, `throw`, expression statements, blocks.

Not allowed: `var`, `switch`, `do … while`, `for … in`, `try` / `catch`,
labels, `with`, `debugger`, function declarations inside functions, classes.
Assignments, `++`/`--` and `push` are statements only, and `continue` inside a
C-style `for` loop is rejected (the update step would be skipped).

## Expressions

- Literals: numbers, strings, template literals (interpolating primitives),
  `true`, `false`, `null`, `undefined`, array literals `[a, b]`, object
  literals `{ id, age }` where the target type is a known struct.
- Identifiers, parenthesised expressions.
- Arithmetic `+ - * / %`, comparison `< <= > >=`, strict equality `=== !==`
  (`==` / `!=` are `NT1001`), logical `&& || !`, unary `-`, compound
  assignment `+= -= *= /=`, `++` / `--` as statements.
- Calls to other functions declared in the same module.
- `await expr` inside `async` functions only.
- Member access `value.field` on structs; `array.length`; `array.push(x)`;
  `array[i]` indexing.
- `throw new LucentError("CODE", { message: "…" })`. `LucentError` is a global
  known to the compiler. Any other thrown value is `NT1001`.
- `obj[key]` on a struct (dynamic property access) → `NT1002`.
- Closures, `this`, `new` of anything but `LucentError`, `typeof`, `in`,
  `instanceof`, spread, destructuring, optional chaining → `NT1001`.

## Semantics

- `number` is an IEEE 754 double. `/` is floating division, `%` follows
  JavaScript (`fmod`), `+` on strings concatenates.
- Sized integers wrap on overflow, as on the target platform.
- Arrays are value-copied when they cross the JS boundary and reference-shared
  inside native code, exactly like Swift `Array` / Kotlin `List` would behave
  in the generated code.
- `Uint8Array` crosses the boundary as an `ArrayBuffer`. Sync functions may
  read it in place; async functions receive a copy. Indexing yields a `number`.
- A thrown `LucentError` reaches JavaScript as an `Error` with `code` and
  `message`, identically on Expo and Nitro hosts.

## Diagnostics

| Code   | Meaning                                         |
| ------ | ----------------------------------------------- |
| NT1000 | Syntax error (from the parser)                  |
| NT1001 | Unsupported syntax                              |
| NT1002 | Dynamic property access                         |
| NT1003 | Unsupported type                                |
| NT1004 | `any` / `unknown` is prohibited                 |
| NT1005 | Function value cannot cross the native boundary |
| NT1006 | Unsupported dependency                          |
| NT1007 | Too many parameters                             |
| NT1010 | Unknown identifier                              |
| NT1011 | Type mismatch                                   |
| NT1012 | Wrong number of arguments                       |
| NT1013 | `await` outside an async function               |
| NT1014 | Missing type annotation                         |
| NT1015 | Missing return                                  |
| NT1016 | Assignment to a `const`                         |

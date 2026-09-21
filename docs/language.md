# The Lucent language

Lucent is a constrained subset of TypeScript. A module is a `*.lucent.ts` file or a `*.lucent.tsx` native component file. The compiler turns it into Swift and Kotlin ahead of time; nothing in the
file ever runs in a JavaScript engine. Everything TypeScript allows but Lucent
does not is rejected with a dedicated `NT` diagnostic, never with a generic
TypeScript error.

## Module shape

- `export function` and `export async function` declarations are the module's
  native API. Non-exported functions are private helpers.
- `type Name = { … }` aliases declare structs. They may be exported or not.
  Value records need at least one field; use `void` for an empty event payload.
- Named imports and aliases can refer to other `.lucent.ts` and `.lucent.tsx`
  files, with an explicit extension or the `.lucent` suffix. Type-only imports
  cannot be used as values. Missing files, ambiguous paths, cycles, and private
  imports are rejected with `NT1006`.
- Native classes and `const name = event<T>()` declarations are supported.
- Built-in packages are `@lucent-lang/types`, `@lucent-lang/objects`,
  `@lucent-lang/events`, `@lucent-lang/ui`, `@lucent-lang/std/*`, and
  `@lucent-lang/platform/*`. Additional native bindings come from app config.
- JavaScript packages, namespace/default imports, re-exports, and executable
  top-level statements remain unsupported. There is no JS runtime in native code.

## Types

| TypeScript                                                                   | Native type    | Swift               | Kotlin            |
| ---------------------------------------------------------------------------- | -------------- | ------------------- | ----------------- |
| `number`                                                                     | `float64`      | `Double`            | `Double`          |
| `string`                                                                     | `string`       | `String`            | `String`          |
| `boolean`                                                                    | `bool`         | `Bool`              | `Boolean`         |
| `void`                                                                       | `void`         | `Void`              | `Unit`            |
| `T[]`, `Array<T>`                                                            | `array<T>`     | `[T]`               | `List<T>`         |
| `T \| null`, `T \| undefined`                                                | `optional<T>`  | `T?`                | `T?`              |
| `Record<string, T>`                                                          | `map<T>`       | `[String: T]`       | `Map<String, T>`  |
| `Uint8Array`                                                                 | `bytes`        | `ArrayBuffer`       | `ArrayBuffer`     |
| `Promise<T>` (return type only)                                              | `promise<T>`   | `async … -> T`      | `suspend …: T`    |
| object type alias                                                            | `struct`       | `struct`            | `data class`      |
| `int8…int64`, `uint8…uint64`, `float32`, `float64` from `@lucent-lang/types` | sized numerics | `Int32`, `Float`, … | `Int`, `Float`, … |

Rules:

- A struct's fields may be any type above except `Promise`. Optional fields
  (`name?: T` or `name: T | null`) become `optional<T>`.
- `Promise<T>` is legal only as the declared return type of an `async` function.
  An `async` function must declare `Promise<T>`; a sync one must not.
- Named discriminated unions are supported as described below. Other unions
  besides `T | null` / `T | undefined` remain unsupported.
- `any`, `unknown` → `NT1004`. Function types → `NT1005`. `never`, `object`,
  `symbol`, `bigint`, tuples, user-defined generics, interfaces, enums → `NT1003`.
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
- Calls to local functions, imported Lucent functions, and registered native bindings.
- `await expr` inside `async` functions only.
- Member access `value.field` on structs; `array.length`; `array.push(x)`;
  `array[i]` indexing.
- `throw new LucentError("CODE", { message: "…" })`. `LucentError` is a global
  known to the compiler. Any other thrown value is `NT1001`.
- `obj[key]` on a struct (dynamic property access) → `NT1002`.
- `this` and `new` are supported for native classes.
- Closures, construction of arbitrary JS objects, `typeof`, `in`,
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

## Discriminated unions

```ts
export type Result = { kind: "ok"; value: number } | { kind: "error"; message: string };

export function read(result: Result): number {
  if (result.kind === "ok") {
    return result.value;
  }
  return 0;
}
```

Variants need a common, required string-literal discriminator with unique tags.
Variants may be inline records or separately named record aliases.
The compiler checks construction and narrows payload access after `===` / `!==`
on a local or parameter, including an early return. `switch` is not supported.
Payload fields shared between variants must have the same type. Union fields
are immutable; replace the whole value to change variants.

The native representation is a tagged record with nullable payload slots.
Generated proxies validate tags and required payloads, pad incoming inactive
slots, and remove inactive slots from returned values. App declarations retain
the TypeScript union.

## Native classes and shared objects

```ts
import { SharedObject } from "@lucent-lang/objects";

export class Counter extends SharedObject {
  value: number = 0;
  constructor(initial: number) {
    super();
    this.value = initial;
  }
  increment(delta: number): number {
    this.value += delta;
    return this.value;
  }
}
```

Classes become reference objects in Swift and Kotlin. JS wrappers carry opaque
handles, so method calls and passing an instance to another Lucent module keep
its native identity. No instance state is copied through JS. Synchronous calls
that cross a shared-object boundary are serialized by a recursive native lock.

Public instance fields must have a declared scalar type (`number`, `string`,
`boolean`, or a nullable form) and an initializer. Methods are synchronous with
explicit types. Inheritance beyond the marker `SharedObject`, private/static
members, getters/setters in source, decorators, and async methods are rejected.
Objects cross function boundaries directly, rather than in arrays, records, or
optionals. Async functions cannot accept shared-object arguments.

Use `counter.dispose()` when the app no longer needs the object. Disposal is
idempotent and invalidates every JS alias. Where the JS engine implements
`FinalizationRegistry`, collection also releases the handle; explicit disposal
is required for deterministic cleanup and on engines without that facility.
The optional `SharedObject` base supplies this method to the TypeScript editor;
plain native classes compile too. Disposing a handle does not execute a custom
native destructor callback.

## Events

```ts
import { event } from "@lucent-lang/events";
export type Progress = { percent: number };
export const progress = event<Progress>();
export function report(value: number): void {
  progress.emit({ percent: value });
}
```

In app code, `progress.subscribe(listener)` returns `{ remove() }`; call
`remove()` when the consumer unmounts. Events are broadcast to active listeners
and are not replayed. Imported event declarations refer to the same native
channel. Native emission snapshots listeners under a lock, then invokes them
outside the lock. Delivery into JS uses the host's scheduling rules.

Payloads are JSON-compatible scalars, records, arrays, maps, and nullable
values. Bytes, shared objects, callbacks, and views cannot be event payloads.
Non-finite floating-point payloads fail serialization. `event<void>()` emits
without an argument. A subscription is app-only; native code emits events.

## Declarative native views (`.lucent.tsx`)

```tsx
import { Column, Text, Button, type NativeProps, type NativeView } from "@lucent-lang/ui";
import type { Event } from "@lucent-lang/events";

type Props = { title: string; onPress: Event<void> };
export function Card(props: NativeProps<Props>): NativeView {
  return (
    <Column padding={16} spacing={12}>
      <Text size={20}>{props.title}</Text>
      <Button title="Continue" onPress={props.onPress} />
    </Column>
  );
}
```

App code imports `Card` and mounts `<Card style={{ height: 140 }} ... />`.
`NativeProps<P>` exposes React Native wrapper props to the editor. Only `P` is
available inside the native render function; React applies wrapper layout.
Exports return `NativeView`, accept one props record (or no arguments), and
become native Expo views or Nitro Fabric views. SwiftUI and Jetpack Compose
render the shared component model. Native view controller containment,
composition disposal, prop updates, and button callback bridging are generated.
Nitro requires the React Native new architecture for these views.

| Primitive       | Props                                             | Children                 |
| --------------- | ------------------------------------------------- | ------------------------ |
| `Column`, `Row` | `padding`, `spacing` in logical units             | native views             |
| `Text`          | `size`, `color` (`#RRGGBB`)                       | strings/numbers/booleans |
| `Spacer`        | `size` (default 8)                                | none                     |
| `Button`        | required `title`, optional `onPress: Event<void>` | none                     |

View props support scalar/nullable scalar values and required `Event<void>`
callbacks. Compose other imported `.lucent.tsx` components with typed props.
Rendering is synchronous and pure: effects, mutation, async calls, and loops
are rejected in render functions. Use app state and callbacks to provide new
props. Hooks, arbitrary React components, dynamic lists, JSX spreads/fragments,
and custom component `children` are not currently part of this subset.

## Threads

```ts
/** @thread worker */
export async function double(value: number): Promise<number> {
  return value * 2;
}
```

`@thread caller` keeps the host's calling context (the default). `@thread main`
uses Swift's main actor / Kotlin `Dispatchers.Main`. `@thread worker` uses a
Swift detached task / Kotlin `Dispatchers.Default`. A thread hop requires an
async function; its JS result is a promise. Thread annotations do not make
shared mutable state safe, so shared-object arguments are restricted as above.

## Standard library, SDK bindings, and capabilities

Available native packages:

- `@lucent-lang/std/math`: `abs`, `sqrt`, `floor`, `ceil`, `sin`, `cos`, `min`, `max`.
- `@lucent-lang/std/text`: `trim`, `contains`.
- `@lucent-lang/platform/clock`: `now()` returns Unix milliseconds; requires `clock`.
- `@lucent-lang/platform/locale`: `languageTag()`; requires `locale`.

An app opts into required capabilities in `lucent.config.json`:

```json
{ "capabilities": ["clock", "locale"] }
```

`build`, `check`, and Metro reject missing capabilities. Generated packages
contain `lucent-manifest.json` with the capabilities used by their modules.
This is a build-time allowlist, not an OS security sandbox. Bindings that need
OS permissions or entitlements still require the corresponding app platform
configuration and runtime permission flow.

A custom SDK binding supplies a typed declaration and trusted native bodies:

```json
{
  "capabilities": ["device"],
  "libraries": {
    "@lucent-lang/platform/device": {
      "source": "export declare function model(): Promise<string>;",
      "bindings": {
        "model": {
          "swiftImports": ["UIKit"],
          "swift": ["return UIDevice.current.model"],
          "kotlin": ["return android.os.Build.MODEL"],
          "capabilities": ["device"],
          "thread": "main"
        }
      }
    }
  }
}
```

Both platform implementations are required. A binding can declare `thread`
(`caller`, `main`, or `worker`); main/worker declarations must return a promise.
The compiler treats manifests as build input, never executing JavaScript from
them. Native bodies must match the declared types. Custom packages also need
matching TypeScript declarations for the app editor.

## Generation and development

`lucent build` discovers both extensions, resolves transitive sources, and
invalidates cached roots when a dependency or binding changes. Generated code
lives in `modules/lucent` for Expo and `.lucent/nitro` for Nitro. `--emit-ir`
writes `.lucent/ir`. Distinct source basenames are required within one build.
The generated-file manifest keeps native build products during regeneration.

After native implementation or API changes, run `lucent build`, refresh native
integration when files are added (`pod install` / Gradle sync), and rebuild the
app. React-side state/prop changes work normally. This remains AOT compilation;
there is no native-code hot-reload interpreter in this release.

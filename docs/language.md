# The Lucent language

Lucent is a constrained subset of TypeScript. A module is a `*.lucent.ts` file or a `*.lucent.tsx` native component file. The compiler turns it into Swift and Kotlin ahead of time; nothing in the
file ever runs in a JavaScript engine. Everything TypeScript allows but Lucent
does not is rejected with a dedicated `LUCENT` diagnostic, never with a generic
TypeScript error.

## Module shape

- `export function` and `export async function` declarations are the module's
  native API. Non-exported functions are private helpers.
- `type Name = { … }` aliases declare structs. They may be exported or not.
  Value records need at least one field; use `void` for an empty event payload.
- Named imports and aliases can refer to other `.lucent.ts` and `.lucent.tsx`
  files, with an explicit extension or the `.lucent` suffix. Type-only imports
  cannot be used as values. Missing files, ambiguous paths, cycles, and private
  imports are rejected with `LUCENT1006`.
- Native classes and `const name = event<T>()` declarations are supported.
- Built-in authoring entry points are `@lucent-lang/core/types`, `@lucent-lang/core/objects`,
  `@lucent-lang/core/events`, `@lucent-lang/core/ui`, `@lucent-lang/core`,
  `@lucent-lang/core/math`, `@lucent-lang/core/text`,
  `@lucent-lang/core/cancellation`, and `@lucent-lang/core/platform`. Every other
  native binding comes from a package manifest listed in app config.
- JavaScript packages, namespace/default imports, re-exports, and executable
  top-level statements remain unsupported. There is no JS runtime in native code.

## Types

| TypeScript                                                                        | Native type    | Swift               | Kotlin            |
| --------------------------------------------------------------------------------- | -------------- | ------------------- | ----------------- |
| `number`                                                                          | `float64`      | `Double`            | `Double`          |
| `string`                                                                          | `string`       | `String`            | `String`          |
| `boolean`                                                                         | `bool`         | `Bool`              | `Boolean`         |
| `void`                                                                            | `void`         | `Void`              | `Unit`            |
| `T[]`, `Array<T>`                                                                 | `array<T>`     | `[T]`               | `List<T>`         |
| `T \| null`, `T \| undefined`                                                     | `optional<T>`  | `T?`                | `T?`              |
| `Record<string, T>`                                                               | `map<T>`       | `[String: T]`       | `Map<String, T>`  |
| `Uint8Array`                                                                      | `bytes`        | `ArrayBuffer`       | `ArrayBuffer`     |
| `Promise<T>` (return type only)                                                   | `promise<T>`   | `async … -> T`      | `suspend …: T`    |
| object type alias                                                                 | `struct`       | `struct`            | `data class`      |
| `int8…int64`, `uint8…uint64`, `float32`, `float64` from `@lucent-lang/core/types` | sized numerics | `Int32`, `Float`, … | `Int`, `Float`, … |

Rules:

- A struct's fields may be any type above except `Promise`. Optional fields
  (`name?: T` or `name: T | null`) become `optional<T>`.
- `Promise<T>` is legal only as the declared return type of an `async` function.
  An `async` function must declare `Promise<T>`; a sync one must not.
- Named discriminated unions are supported as described below. Other unions
  besides `T | null` / `T | undefined` remain unsupported.
- `any`, `unknown` → `LUCENT1004`. Function types → `LUCENT1005`. `never`, `object`,
  `symbol`, `bigint`, tuples, user-defined generics, interfaces, enums → `LUCENT1003`.
- Optionals must be narrowed before use: `if (x === null) { … }` or
  `if (x !== null) { … }` on a local or parameter, including the early-return
  form. There is no truthiness: `if (x)` is `LUCENT1011` unless `x` is a boolean.
- Arithmetic and ordinary Lucent calls never convert numeric types implicitly; `int32 + number` is `LUCENT1011`. Integer
  literals adopt the sized type of their context.
- `await` outside an `async` function is a parse error (`LUCENT1000`).
- A function may take at most 8 parameters → `LUCENT1007 Too many parameters`.
- Parameters and return types must be annotated. Locals may be inferred from
  their initializer.

## Statements

`const`, `let`, `if` / `else`, `while`, `for (;;)`, `for … of` over an array,
`return`, `break`, `continue`, `throw`, expression statements, blocks.

Not allowed: `var`, `switch`, `do … while`, `for … in`, `try` / `catch`,
labels, `with`, `debugger`, function declarations inside functions, nested classes.
Assignments, `++`/`--` and `push` are statements only, and `continue` inside a
C-style `for` loop is rejected (the update step would be skipped).

## Expressions

- Literals: numbers, strings, template literals (interpolating primitives),
  `true`, `false`, `null`, `undefined`, array literals `[a, b]`, object
  literals `{ id, age }` where the target type is a known struct.
- Identifiers, parenthesised expressions.
- Arithmetic `+ - * / %`, comparison `< <= > >=`, strict equality `=== !==`
  (`==` / `!=` are `LUCENT1001`), logical `&& || !`, unary `-`, compound
  assignment `+= -= *= /=`, `++` / `--` as statements.
- Calls to local functions, imported Lucent functions, and registered native bindings.
- `await expr` inside `async` functions only.
- Member access `value.field` on structs; `array.length`; `array.push(x)`;
  `array[i]` indexing.
- `throw new LucentError("CODE", { message: "…" })`. `LucentError` is a global
  known to the compiler. Any other thrown value is `LUCENT1001`.
- `obj[key]` on a struct (dynamic property access) → `LUCENT1002`.
- `this` and `new` are supported for native classes.
- Closures, construction of arbitrary JS objects, `typeof`, `in`,
  `instanceof`, spread, destructuring, optional chaining → `LUCENT1001`.

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
  `message`, and scalar `metadata`, identically on Expo and Nitro hosts.
  Error envelopes preserve Unicode and newlines without exposing native stack
  traces. Metadata values are strings, numbers, booleans, or null; nested
  objects and arrays are rejected. Non-finite numbers normalize to null.

## Diagnostics

| Code       | Meaning                                          |
| ---------- | ------------------------------------------------ |
| LUCENT1000 | Syntax error (from the parser)                   |
| LUCENT1001 | Unsupported syntax                               |
| LUCENT1002 | Dynamic property access                          |
| LUCENT1003 | Unsupported type                                 |
| LUCENT1004 | `any` / `unknown` is prohibited                  |
| LUCENT1005 | Function value cannot cross the native boundary  |
| LUCENT1006 | Unsupported dependency                           |
| LUCENT1007 | Too many parameters                              |
| LUCENT1010 | Unknown identifier                               |
| LUCENT1011 | Type mismatch                                    |
| LUCENT1012 | Wrong number of arguments                        |
| LUCENT1013 | `await` outside an async function                |
| LUCENT1014 | Missing type annotation                          |
| LUCENT1015 | Missing return                                   |
| LUCENT1016 | Assignment to a `const`                          |
| LUCENT1018 | Borrowed value escapes its scope                 |
| LUCENT1019 | Native call is on the wrong executor             |
| LUCENT2001 | Missing native capability                        |
| LUCENT2004 | Platform-specific API                            |
| LUCENT3002 | Potentially expensive main-thread work (warning) |

`LUCENT1xxx` is the language subset, `LUCENT2xxx` is the target
platform, and `LUCENT3xxx` is a warning. The former abbreviated prefixes are replaced by `LUCENT`; numeric identities
are unchanged.

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
import { SharedObject } from "@lucent-lang/core/objects";

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

Public and private instance fields must have a declared scalar type (`number`, `string`,
`boolean`, or a nullable form) and an initializer. Methods are synchronous with
explicit types and may accept/return buffers. Private fields stay native and
have no JS bridge accessors; accesses outside their class are rejected.
Inheritance beyond the marker `SharedObject`, static members, private methods,
getters/setters in source, class decorators, and async methods are rejected.
Objects cross function boundaries directly, rather than in arrays, records, or
optionals. Async functions cannot accept Lucent-authored shared-object arguments;
explicitly transferable SDK references have the separate contract described below.

Use `counter.dispose()` when the app no longer needs the object. Disposal is
idempotent and invalidates every JS alias. Where the JS engine implements
`FinalizationRegistry`, collection also releases the handle; explicit disposal
is required for deterministic cleanup and on engines without that facility.
The optional `SharedObject` base supplies this method to the TypeScript editor;
plain native classes compile too. Disposing a handle does not execute a custom
native destructor callback.

## Events

```ts
import { event } from "@lucent-lang/core/events";
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
import { VStack, Text, Button, type NativeProps, type NativeView } from "@lucent-lang/core/ui";
import type { Event } from "@lucent-lang/core/events";

type Props = { title: string; onPress: Event<void> };
export function Card(props: NativeProps<Props>): NativeView {
  return (
    <VStack padding={16} spacing={12}>
      <Text size={20}>{props.title}</Text>
      <Button title="Continue" onPress={props.onPress} />
    </VStack>
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

| Primitive          | Props                                             | Children                 |
| ------------------ | ------------------------------------------------- | ------------------------ |
| `VStack`, `HStack` | `padding`, `spacing` in logical units             | native views             |
| `Text`             | `size`, `color` (`#RRGGBB`)                       | strings/numbers/booleans |
| `Spacer`           | `size` (default 8)                                | none                     |
| `Divider`          | none                                              | none                     |
| `Button`           | required `title`, optional `onPress: Event<void>` | none                     |
| `For`              | required `each`, optional `by`                    | one row closure          |

View props support string, number, boolean, arrays of those, nullable scalars,
and events. A component may also declare one `children: NativeView` prop, which
receives the JSX children written at its call site:

```tsx
type PanelProps = { title: string; children: NativeView };
export function Panel(props: PanelProps): NativeView {
  return (
    <VStack spacing={6}>
      <Text size={12}>{props.title}</Text>
      {props.children}
    </VStack>
  );
}
```

`<Panel title="Log"><Text>one</Text></Panel>` fills the slot. Several children
group vertically with zero spacing, like the layout wrappers. A component with a
slot is Lucent-only: React owns the children of a host view, so the compiler does
not generate a React component or a declaration for it. Components without a
slot take no children. A conditional expression may choose between two views or
two values of the same type. `For` lays rows out eagerly in array order. Without a `by` the identity is the
index, which is not stable across insertions; pass
`by={(item: T) => item}` to give each row an identity that survives reordering,
so its state and focus move with it. A key closure returns a string, so use a
template literal for a numeric identity. Duplicate keys are a programming error:
debug builds report one and the row falls back to a position-disambiguated
identity instead of disappearing. Compose other imported `.lucent.tsx`
components with typed props.

`const name = state(literal)` at the top of a view declares scalar state owned
by that host instance. A number, string, or boolean literal is the initial
value. Prop updates do not reset it. Read `name` for the current value.
`name.set(next)` is allowed in an event handler and sees the latest value, so
`taps.set(taps + 1)` does not lose increments to a stale render. `state()`
inside a branch, loop, or nested block is rejected, as is calling `set` while
rendering.

Rendering stays synchronous. Effects, mutation, async calls, and loops in the
render body are rejected. Handlers may update state and may be closures passed
to `onPress` or `onChange`. Hooks, arbitrary React components, JSX spreads, and
fragments are not part of this subset.

`VStack` arranges children vertically and `HStack` horizontally. They emit
SwiftUI `VStack` / `HStack` on iOS and Compose `Column` / `Row` on Android.
The former Lucent names `Column` and `Row` are no longer exported; migrate
imports and JSX tags to `VStack` and `HStack` respectively.

## Threads

```ts
@Background
export async function double(value: number): Promise<number> {
  return value * 2;
}
```

`@Inherited` keeps the host's calling context (the default). `@MainThread`
uses Swift's main actor / Kotlin `Dispatchers.Main`. `@Background` uses a
Swift detached task / Kotlin `Dispatchers.Default`. A thread hop requires an
async function; its JS result is a promise. Decorators do not make
shared mutable state safe, so shared-object arguments are restricted as above.

Decorators take no arguments and apply to top-level functions, including private
helpers. Legacy `/** @thread … */` comments are rejected with a migration diagnostic.
Function decorators are a Lucent syntax extension, not standard TypeScript
method decorators. For editor checking of source files, place
`// @ts-expect-error Lucent function decorator; compiled before TypeScript.`
immediately before the decorator. The compiler processes it before Metro
passes the generated JS proxy to TypeScript tooling.

`LUCENT3002` warns about loops, recursion, and bindings marked `cost: "cpu" | "io"`
reached from `@MainThread`, including calls through private helpers. Explicit
background hops stop propagation. Warnings are retained on incremental cache
hits and do not fail builds. This is conservative static analysis, not a
runtime duration guarantee.

## Built-in libraries and memory

Lucent ships the primitives a compiler must own, and nothing else. Anything a
platform SDK provides reaches source through a package manifest, so a built-in
never has a capability an app package could not also declare.

| Package                  | APIs                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `@lucent-lang/core`      | `encodeUTF8`, `decodeUTF8`, `copyBytes`                    |
| `@lucent-lang/core/math` | `abs`, `sqrt`, `floor`, `ceil`, `sin`, `cos`, `min`, `max` |
| `@lucent-lang/core/text` | `trim`, `contains`                                         |

`@lucent-lang/core/platform` exposes the `Platform.OS` guard and
`@lucent-lang/core/cancellation` the cooperative `CancellationSource`. Neither
requires a capability.

The former `@lucent-lang/crypto`, `@lucent-lang/filesystem`,
`@lucent-lang/network`, `@lucent-lang/device`, `@lucent-lang/core/platform/clock`,
and `@lucent-lang/core/platform/locale` packages have been removed. They were small
hand-written native modules rather than language features, and they duplicated
libraries an app already has. Declare the ones you need as package bindings, as
the example apps do in `native/toolkit.library.json`, or call the equivalent
JavaScript API. Importing them now fails with `LUCENT1006`.

```ts
import { encodeUTF8 } from "@lucent-lang/core";
import { sha256 } from "@lucent-lang/example-toolkit";

export function fingerprint(text: string): string {
  return sha256(encodeUTF8(text));
}
```

Native results own their bytes. Swift adapters use `Data`; Kotlin uses
`ByteArray` / direct `ByteBuffer`. JS input buffers are copied for async calls
before native work outlives the call. Synchronous access may borrow through the
host SDK; `copyBytes` always creates independent storage. Empty buffers and
UTF-8 are supported. No binary payload is serialized through JSON. Do not
mutate or detach a borrowed input during a synchronous native call.

## Typed capabilities

An app can use `lucent.config.ts`:

```ts
import { defineNativeConfig } from "@lucent-lang/core/config";
export default defineNativeConfig({
  capabilities: {
    camera: { reason: "Scan documents" },
    location: { whenInUse: { reason: "Show nearby stores" } },
    network: true,
  },
});
```

Configuration is parsed as literal data. Function calls other than the outer
`defineNativeConfig`, spreads, computed values, and executable statements are
rejected; configuration code is never evaluated. `lucent.config.json` remains
supported, including legacy string allowlists for custom capabilities. Keep
one configuration file per app. Legacy lists grant build access only; use the
object form to generate permission configuration.

Camera, microphone, photos, bluetooth, and location require nonempty usage
reasons. Notifications take `{ environment: "development" | "production" }`
for the APNs entitlement. `network`, `filesystem`, `crypto`, and `device` take
booleans. Unknown capability names in the typed form fail the build; use the
`lucent.config.json` string list for a capability of your own. The `clock` and
`locale` capabilities were removed with the built-ins that used them.

`build`, `check`, and Metro enforce the required capability allowlist. Outputs
include `lucent-manifest.json`, `lucent-platform-config.json`,
`ios/LucentInfo.plist`, `ios/Lucent.entitlements`, and the Android library
manifest. Android Gradle merges the library's permissions into the app.
The Expo plugin merges usage descriptions, entitlements, and Android
permissions during prebuild while preserving unrelated settings. In a bare
app, merge the generated plist/entitlement fragments into the app target and
select its entitlements file in Xcode; generated library files alone cannot
change the app's signing entitlements. Runtime permission prompts remain the
app's responsibility. This is build configuration, not a security sandbox.

## Platform guards and SDK bindings

```ts
import { Platform } from "@lucent-lang/core/platform";
import { homeDirectory } from "@lucent-lang/sdk/foundation";

export function home(): string {
  if (Platform.OS === "ios") {
    return homeDirectory();
  }
  return "";
}
```

Bindings declare `platforms: ["ios"]` or `["android"]`. `LUCENT2004` rejects calls
reachable on another target. Equality/inequality guards narrow `if` branches,
`else`, negation, and short-circuit expressions; the analysis follows private
helper calls. Every exported function is also checked as an independent
entry point. A guard does not narrow following statements outside its branch.
Unavailable target implementations become throwing stubs and their imports
are omitted, so the other target still compiles.

Generate SDK manifests with the CLI:

```sh
lucent sdk swift Foundation.swiftinterface --module Foundation --out sdk/foundation
lucent sdk android - --classpath /path/to/android.jar --class java.lang.Math --out sdk/math
```

The output contains a versioned `schema.json`, `library.json` with native
bindings, and `index.d.ts`. Java extraction uses `javap -public`; saved javap
output can also be supplied instead of `-`. Register the generated manifest:

```ts
import { defineNativeConfig } from "@lucent-lang/core/config";
export default defineNativeConfig({
  libraries: { "@lucent-lang/sdk/math": "./sdk/math/library.json" },
});
```

Expose the generated declarations through a local package export or editor
path mapping with the same import specifier. Current extraction handles
single-line public Swift free-function declarations and public Java static
methods using supported scalar types (`Double`/`double`, `String`,
`Bool`/`boolean`, `Int32`/`int`, and void). Swift parameter labels and throws
are retained. Scalar free-function overloads are preserved and selected by argument types. Instance methods, callbacks, generics,
attribute/availability-gated declarations, and unsupported types are reported and
omitted. Full SDK class/Objective-C/Kotlin-metadata import is not implemented;
those APIs still need a curated binding manifest.

Custom manifests contain `source` declarations and `bindings` keyed by export
name. Each binding supplies `swift` and `kotlin` body-line arrays, optional
imports, capabilities, platform availability, cost, and execution `thread`
(`caller`, `main`, `worker`). Bodies are trusted native build inputs and must
match their declaration. Async declarations return `Promise<T>`. No JavaScript
implementation from a package runs on the native side.

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

## Native SDK objects and callbacks

Curated libraries may declare `references` alongside `source` and `bindings`.
Each reference maps a record name to an actual Swift class and/or Kotlin class
(`swift`, `kotlin`, and optional per-language imports). Lucent emits a native
type alias, retaining the SDK instance itself. Ordinary local references use
native ownership; JavaScript-visible objects use the existing identity registry
and `dispose()` invalidates their handles.

Declare operations as `Name__create`, `Name__get_property`,
`Name__set_property`, and `Name__method_methodName`. Instance operations take
`lucentSelf: Name` first. Source code uses `new Name(...)`, `object.property`,
and `object.methodName(...)`. A property without a setter is read-only. Native constructors must be synchronous. Native
property writes currently require simple assignment; compound updates are
rejected. Binding platform restrictions still require `Platform.OS` guards.

`generateBindingLibrary` also accepts curated `SDKSchema.classes` entries with
constructors, properties, and methods. The text-based SDK extractors still
report unsupported class declarations and do not yet emit overload groups for
them; a curated manifest can declare those groups by hand.

Constructors and instance methods take overload groups like free functions.
Name each candidate `Name__create__<suffix>` or `Name__method_<name>__<suffix>`
and give them a shared `overload` of `Name__create` or `Name__method_<name>`.
Source code keeps writing `new Name(...)` and `object.name(...)`; the compiler
selects one concrete operation before lowering. `new` is a single JavaScript
function, so constructor overloads must differ in arity or in what `typeof`
reports for an argument. Two that look identical to JavaScript are rejected,
because distinguishing `number` from `int32` at runtime would be a guess. The
generated class declares one TypeScript constructor per overload and its proxy
dispatches on arity and argument kind.

Compiled functions can be passed to other native functions using
`NativeCallback`:

```ts
import type { NativeCallback } from "@lucent-lang/core/types";

function twice(value: number): number {
  return value * 2;
}
function apply(value: number, callback: NativeCallback<(value: number) => number>): number {
  return callback(value);
}
export function result(): number {
  return apply(4, twice);
}
```

Callbacks are synchronous, typed native function references. Swift callbacks
can throw and are escaping parameters; Kotlin callbacks use native function
types. Native adapters own retention, cancellation, executor selection, and
error handling when connecting these functions to SDK listeners. Async function
references and callbacks crossing the JavaScript boundary are rejected. Use
`Event<T>` for JavaScript notifications. A binding with `nativeOnly: true`
remains callable from Lucent but is omitted from generated JavaScript methods.
Synchronous arrow callbacks support expression bodies (or a single return),
with explicit parameter types or a contextual `NativeCallback` signature.
They may capture `const` numeric, string, boolean, and immutable value-record
locals (`value`), and an immutable owned native reference (`retained`).
`weak(reference)` captures that owned reference as an optional; the closure must
handle `null` before using it. A callback parameter whose contract says
`retention: "call"` may capture a borrow (`borrowed`). A subscription, or a
callback with no retention, may not. Mutable locals, external resources, and
nested callback results are rejected. For example,
`const factor = 2; apply(4, (value: number) => value * factor)` compiles into a
native Swift/Kotlin closure.

Protocol implementations remain unsupported. Weak captures are explicit and
nullable. A nonescaping callback may close over a borrow for the duration of
the call.
The native registry provides typed leases: releasing a handle immediately invalidates new lookup;
an acquired lease retains the object until closed. Closing is idempotent and
distinct from SDK resource cleanup. Expo and Nitro accept asynchronous arguments for SDK reference types with
`contract: { ownership: "owned", executor: "caller", transferable: true }`.
The adapter author must guarantee that these objects are safe across executors;
Lucent does not infer thread safety from a class name. Mutable shared classes,
externally owned references, and executor-confined references remain rejected.

Generated JS proxies retain accepted calls through dispatch; disposing a wrapper
immediately rejects new work while prior calls finish. Native async wrappers
acquire a lease group and release it on completion or failure. A lease keeps
memory alive; it neither requests cancellation nor invokes an SDK close method.
If an accepted call returns the same native object after its original wrapper
was disposed, its new wrapper shares retention with all outstanding calls.
Disposing that replacement releases the handle only after calls accepted by
every wrapper generation have completed or failed.

## Native controls and package views

Author views in `.lucent.tsx`. Shared controls include `TextField`, `Toggle`,
`Slider`, `ScrollView`, `ZStack`, `Divider`, and `For`, alongside `VStack`,
`HStack`, `Text`, `Spacer`, and `Button`. Text fields, toggles, and sliders take
a `value` and `onChange`. The value may be a prop or view `state`; `onChange`
may be an event or a closure that calls `set`. Native change events carry
string, boolean, or number payloads through both Expo and Nitro. `Slider`
defaults to the range 0–1. `For` repeats one row closure for each element of a
string, number, or boolean array, keyed by `key` when given and by index
otherwise.

`Padding`, `Background`, `CornerRadius`, and `Accessibility` wrap their children
in a vertical group. Nest wrappers to specify composition order. These are
layout wrappers, not a complete SwiftUI/Compose modifier API; multiple children
are grouped vertically with zero spacing.

A library may add a `views` map. Each descriptor declares typed `props`,
`required` prop names, `children` (`views`, `text`, or `none`), and `swift`/`kotlin`
templates. Templates substitute `{{prop:name}}` and `{{children}}`; optional
props referenced by a template require a native-expression entry in `defaults`.
Per-language `imports` are emitted with the native render functions. Metadata
and required props are checked before native generation. Templates are trusted
package code, like function binding bodies.

Native adapter implementations can ship in the library's `native` object:

```json
{
  "native": {
    "swift": { "Widget.swift": "import SwiftUI\n// adapter implementation" },
    "kotlin": { "Widget.kt": "package {{androidPackage}}\n// adapter implementation" },
    "dependencies": {
      "pods": { "WidgetSDK": "~> 1.0" },
      "android": ["dev.widgets:ui:1.0.0"]
    }
  }
}
```

Package-level `native.capabilities` declares required capability names; these
participate in the same app allowlist checks as function bindings.

The hosts emit each imported package once under `ios/LucentPackages/` and
`android/src/main/java/LucentPackages/`, append CocoaPods/Gradle dependencies,
and replace the Kotlin package placeholder. Source keys must be simple
`.swift`/`.kt` filenames. Conflicting package contents or pod versions fail
generation. Android compositions use [detach/pool disposal](https://developer.android.com/reference/kotlin/androidx/compose/ui/platform/ViewCompositionStrategy) so an unmounted host does not wait for the activity to be destroyed.
Adapters implement their own native view lifecycle and may own
SwiftUI `@State` or Compose `remember` state. Both example apps demonstrate a
package-defined counter whose state stays native while changes notify React.
This is adapter-owned state; Lucent state hooks, keyed lists, native delegate
syntax, and the camera acceptance feature remain future compiler work.

## SDK enums and option sets

A package manifest may declare `enums`. Each entry names the Lucent cases and,
per target, the native type plus one native expression per case:

```json
{
  "source": "export type Position = \"front\" | \"back\";\nexport declare function setPosition(position:Position):void;",
  "enums": {
    "Position": {
      "cases": ["front", "back"],
      "swift": {
        "type": "AVCaptureDevice.Position",
        "values": { "front": ".front", "back": ".back" },
        "imports": ["AVFoundation"]
      },
      "kotlin": { "type": "Int", "values": { "front": "0", "back": "1" } }
    }
  }
}
```

The manifest's `source` must declare the same cases, in the same order, as a
string-literal union; a mismatch is `LUCENT1006`. Both targets are required, and
each needs one value per case.

In Lucent source a case is an ordinary string literal that adopts the enum type
from its context. Native code only ever sees the SDK value:

```ts
import { setPosition, currentPosition } from "@lucent-lang/example-camera";
import type { Position } from "@lucent-lang/example-camera";

export function useBack(): void {
  setPosition("back");
}
export function facing(): Position {
  return currentPosition();
}
export function isBack(): boolean {
  return currentPosition() === "back";
}
```

A literal outside the case list is `LUCENT1011` and the diagnostic lists the valid
cases. A plain `string` is not an enum; annotate the value with the enum type.
Enums compare with `===` and `!==` against case literals.

Enums cross into JavaScript as their case name, typed as the literal union in
the generated declarations. The compiler emits a `LucentEnum_<Name>` bridge per
target; an unrecognised name from JavaScript throws `INVALID_ENUM_CASE` instead
of guessing. Enums are parameter, return and local types only: they cannot be
record fields, event payloads, or sit inside arrays, maps or optionals. Carry a
case through those as a plain string.

## Versioned native contracts and overloads

Binding libraries may set `schemaVersion: 1`. Unsupported schema versions and
invalid contract metadata produce `LUCENT1006`. Native bindings can attach a
`contract` with a stable `symbolId`; `nativeSymbolId(module, owner, name, abi)`
constructs identities independently of a Lucent alias. SDK free-function
extraction emits these identities and stable internal aliases for overloads.

Bindings can share `overload: "publicName"`. Import the public name to select
one concrete native operation before IR lowering. Exact argument types take
priority over nullable lifting and contextual numeric literals. No match or a
tie produces a diagnostic listing candidate signatures; declaration order does
not break ties. Numeric variable widening, contextual callback overloads, and
automatic class-method overload generation are not yet supported.

`contract.availability` specifies minimum versions, for example
`{ ios: "17.0", android: 30 }`. Configure `targets` with the same shape in
`lucent.config.ts`. Reachable calls are checked against the configured minimums
within platform guards. Generated CocoaPods and Gradle files raise deployment
minimums to the configured targets; they never lower a host's existing minimum.
Targets also participate in the CLI cache key.

Reference ownership and explicit executor-neutral transferability are enforced
for async arguments as described above. A call whose `contract.result` is
`borrowed` cannot be returned, stored, passed where a borrow was not declared,
or used after `await`. A reference `contract.close` method makes later uses of
that identifier an error, including when only one branch closes it. Call
`contract.executor`, or the receiver's object executor when the call does not
set one, must match the enclosing function: `main` and `worker` require
`@MainThread` and `@Background`; `serial` stays on the caller and cannot hop.
Callback retention and automatic SDK cancellation adapters are not implemented.
An ownership declaration alone does not make an object transferable.

The standalone `@lucent-lang/std` package has been removed. Its supported math
and text operations are preserved as `@lucent-lang/core/math` and
`@lucent-lang/core/text`; update imports accordingly.

## Cooperative cancellation

`@lucent-lang/core/cancellation` declares a native `CancellationSource`. Create
it inside Lucent and expose a factory when JavaScript needs to control it:

```ts
import { CancellationSource } from "@lucent-lang/core/cancellation";

export function createCancellation(): CancellationSource {
  return new CancellationSource();
}

@Background
export async function total(values: number[], cancellation: CancellationSource): Promise<number> {
  let result = 0;
  for (const value of values) {
    cancellation.throwIfCancelled();
    result += value;
  }
  return result;
}
```

The returned JS object exposes `cancel()`, `cancelled`, `throwIfCancelled()`,
`scope()`, `finish()`, and `dispose()`. `cancel()` is idempotent and safe across
executors. Once requested, `cancelled` remains true and `throwIfCancelled()`
throws a native `LucentError` with code `CANCELLED`. `scope()` returns a child
source that becomes cancelled with its parent, including when the parent is
already cancelled. `finish()` returns true once; it returns false when
cancellation already won or completion already happened. Swift protects this
state with a lock; Kotlin uses the same lock around the completion bit and an
atomic cancellation flag. This built-in reference satisfies the explicit async
ownership contract.

Cancellation is cooperative: it takes effect when authored code checks a
checkpoint. A successful `finish()` may win a race with cancellation, and a
request does not interrupt a blocking SDK call or prove that pending work has
stopped. Use a fresh source for a new independent cancellation lifetime.

Disposing the JS handle rejects new access while existing async leases remain
valid. Disposal does not request cancellation. Call `cancel()` before disposal
when work should be asked to stop. SDK-specific cancellation adapters and
quiescent resource close remain unfinished.

### Diagnostic code namespace

Compiler diagnostics use `LUCENT` followed by four digits, for example
`LUCENT1010` for an unknown identifier. The numeric identities are unchanged
from the previous abbreviated prefixes; tools matching diagnostic codes should
update their prefix. Native operation error codes such as `CANCELLED` retain
their domain meaning.

### Native dependency agreement

Package adapters that require the same CocoaPods dependency or Android
`group:artifact` must declare identical version requirements. Lucent reports
both importing package specifiers and requirements when they differ, before
writing the generated package. This intentionally requires explicit agreement:
Lucent does not solve overlapping ranges or silently accept Gradle choosing a
higher SDK version. Compatible but differently written ranges must be aligned
by the adapter authors too. Classifiers and extensions share the Android module
version check. Android dependencies use `group:artifact:version`, optionally
followed by `:classifier` and `@extension`.

Registered native adapters may use any package specifier, including scoped
third-party names and subpath exports. Registration supplies native declarations
and bindings; a package name alone never permits importing JavaScript into
native code. Lucent's own namespace is not required for extension packages.

### Lossless numeric SDK arguments

Native binding calls may widen a numeric variable when every value of its source
representation fits exactly in the parameter type. Overload resolution prefers
an exact match, then nullable lifting, then a lossless widening. Multiple equally
ranked candidates remain an ambiguity; return types do not break ties.

Supported widenings are larger integers of the same signedness; unsigned to a
strictly larger signed integer; `float32` to `float64`; integers up to 16 bits to
`float32`; and integers up to 32 bits to `float64`. Signed-to-unsigned conversions,
integer narrowing, `int64`/`uint64` to floating point, and `float64` to `float32`
are rejected for variables. Ordinary authored Lucent functions and arithmetic
retain their strict numeric type rules. This does not add numeric conversion
inside arrays, records, or optional values.

### Structured Swift SDK extraction

`lucent sdk swift-symbolgraph SDK.symbols.json --out sdk/bindings` reads Swift
compiler symbol graph format 0.6. The graph supplies its module name, stable
symbol identities, function signatures, and argument labels. Supported public
scalar free functions generate overload declarations and native bindings through
the same package API as curated adapters.

Alongside `schema.json`, `library.json`, and `index.d.ts`, the command writes
`coverage.json`: every symbol is either supported or skipped with a reason.
Coverage includes the SHA-256 of the input, extractor version, graph format,
compiler generator string, and graph platform metadata. A graph with no supported
symbols still writes coverage and exits unsuccessfully. Unknown graph formats
and duplicate symbol identities fail explicitly.

This first structured adapter reports protocols, members, generics, unsupported
effects, and availability annotations as skipped. It does not infer ownership,
thread safety, or iOS availability from a macOS graph. Review the extraction
platform and supply curated contracts for platform-specific SDK APIs. Clang,
Objective-C, JVM class metadata, and Kotlin metadata adapters remain pending.

### Public package layout

Install `@lucent-lang/core`; install `@lucent-lang/cli` separately for the CLI.
Authoring declarations are `/types`, `/ui`, `/objects`, `/events`, `/platform`,
`/math`, `/text`, and `/cancellation`. Use `/config` for `defineNativeConfig`,
`/metro` for `withLucent`, `/expo` for the Expo plugin, and `/runtime` for JavaScript
helpers. Subpaths are imports, not separate packages to install.

The old standalone types, UI, objects, events, platform, and configuration
packages are removed; no compatibility aliases are provided. Compiler, backends,
hosts, and runtime implementations remain internal dependencies installed by
core or the CLI. Expo itself is optional for bare Nitro projects.

`For` uses `by={(row) => row}` for its identity selector. React reserves JSX
`key` for scalar keys, so Lucent does not use it for a callback. The UI entry
also declares the native `state()` primitive for editor typechecking.

Async SDK instance methods expose `Promise<T>` in generated declarations. Their
proxies retain both the receiver and native-object arguments before dispatch,
await completion before converting the result, and release transit retention on
success, native rejection, or conversion failure. Immediate `dispose()` rejects
new calls without invalidating an accepted method call. Async methods still
require owned, transferable, executor-neutral SDK reference contracts.

### Native task scopes

Import `TaskScope` and `NativeTask` from `@lucent-lang/core/tasks` to track native
operations across suspension. Create a scope with `new TaskScope()` and register
work with `scope.begin()` (or `new NativeTask(scope)`). `scope.activeCount` counts
operations that have not actually completed.

`await scope.close()` atomically rejects new work with `CLOSED_SCOPE`, requests
cancellation for every active task, and waits until every task calls `finish()`.
Multiple callers may await close. `scope.closing` becomes true as soon as close
starts and remains true. An empty scope closes immediately.

A task exposes `cancelled`, `finished`, `cancel()`, `throwIfCancelled()`, and
`finish()`. Cancellation is cooperative; checkpoints throw `CANCELLED`.
`finish()` records completion exactly once and returns true only for the first
completion when cancellation has not already won. A cancelled task still needs
to finish before its scope can close. Cancelling an already finished task has no
effect. Scope/task state is synchronized on both native targets.

SDK adapters must retain each task and call `finish()` on every actual completion
or error path, after their cleanup. This primitive does not automatically cancel
SDK work or attach to arbitrary platform tasks. If an adapter never reports
completion, close remains pending. Do not await scope close from work that must
itself finish before that close can return. `dispose()` invalidates a bridge
handle; it neither requests cancellation nor reports operation completion.

Native instance-method overloads use their binding's public group name (for
example, `Box__method_measure`). Generated JavaScript exposes `box.measure(...)`
with one TypeScript signature per overload and dispatches by argument count and
runtime argument kind. Nullable arguments accept null, undefined, or their
underlying value. Calls with no matching signature throw `TypeError`.

Constructor and method overloads must be distinguishable in JavaScript. Numeric
widths, different object types, and overlapping nullable signatures cannot
select different overloads at this boundary; give these operations separate
public names. Overloads of one method must also share their completion contract:
all synchronous or all asynchronous. Async overloads retain their receiver and
native arguments through completion, including after immediate disposal.

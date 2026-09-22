# The Lucent language

Lucent is a constrained subset of TypeScript. A module is a `*.lucent.ts` file or a `*.lucent.tsx` native component file. The compiler turns it into Swift and Kotlin ahead of time; nothing in the
file ever runs in a JavaScript engine. Everything TypeScript allows but Lucent
does not is rejected with a dedicated `LC` diagnostic, never with a generic
TypeScript error.

## Module shape

- `export function` and `export async function` declarations are the module's
  native API. Non-exported functions are private helpers.
- `type Name = { … }` aliases declare structs. They may be exported or not.
  Value records need at least one field; use `void` for an empty event payload.
- Named imports and aliases can refer to other `.lucent.ts` and `.lucent.tsx`
  files, with an explicit extension or the `.lucent` suffix. Type-only imports
  cannot be used as values. Missing files, ambiguous paths, cycles, and private
  imports are rejected with `LC1006`.
- Native classes and `const name = event<T>()` declarations are supported.
- Built-in packages are `@lucent-lang/types`, `@lucent-lang/objects`,
  `@lucent-lang/events`, `@lucent-lang/ui`, `@lucent-lang/core/*`, and
  `@lucent-lang/platform`, `@lucent-lang/platform/*`, and the native libraries
  listed below. Additional native bindings come from app config.
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
- `any`, `unknown` → `LC1004`. Function types → `LC1005`. `never`, `object`,
  `symbol`, `bigint`, tuples, user-defined generics, interfaces, enums → `LC1003`.
- Optionals must be narrowed before use: `if (x === null) { … }` or
  `if (x !== null) { … }` on a local or parameter, including the early-return
  form. There is no truthiness: `if (x)` is `LC1011` unless `x` is a boolean.
- Numeric types never convert implicitly; `int32 + number` is `LC1011`. Integer
  literals adopt the sized type of their context.
- `await` outside an `async` function is a parse error (`LC1000`).
- A function may take at most 8 parameters → `LC1007 Too many parameters`.
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
  (`==` / `!=` are `LC1001`), logical `&& || !`, unary `-`, compound
  assignment `+= -= *= /=`, `++` / `--` as statements.
- Calls to local functions, imported Lucent functions, and registered native bindings.
- `await expr` inside `async` functions only.
- Member access `value.field` on structs; `array.length`; `array.push(x)`;
  `array[i]` indexing.
- `throw new LucentError("CODE", { message: "…" })`. `LucentError` is a global
  known to the compiler. Any other thrown value is `LC1001`.
- `obj[key]` on a struct (dynamic property access) → `LC1002`.
- `this` and `new` are supported for native classes.
- Closures, construction of arbitrary JS objects, `typeof`, `in`,
  `instanceof`, spread, destructuring, optional chaining → `LC1001`.

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

| Code   | Meaning                                          |
| ------ | ------------------------------------------------ |
| LC1000 | Syntax error (from the parser)                   |
| LC1001 | Unsupported syntax                               |
| LC1002 | Dynamic property access                          |
| LC1003 | Unsupported type                                 |
| LC1004 | `any` / `unknown` is prohibited                  |
| LC1005 | Function value cannot cross the native boundary  |
| LC1006 | Unsupported dependency                           |
| LC1007 | Too many parameters                              |
| LC1010 | Unknown identifier                               |
| LC1011 | Type mismatch                                    |
| LC1012 | Wrong number of arguments                        |
| LC1013 | `await` outside an async function                |
| LC1014 | Missing type annotation                          |
| LC1015 | Missing return                                   |
| LC1016 | Assignment to a `const`                          |
| LC1018 | Borrowed value escapes its scope                 |
| LC1019 | Native call is on the wrong executor             |
| LC2001 | Missing native capability                        |
| LC2004 | Platform-specific API                            |
| LC3002 | Potentially expensive main-thread work (warning) |

`LC` stands for Lucent. `LC1xxx` is the language subset, `LC2xxx` is the target
platform, and `LC3xxx` is a warning. These codes were spelled `NT####` before
this release; the numbers are unchanged, so `NT1004` is now `LC1004`.

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
import { VStack, Text, Button, type NativeProps, type NativeView } from "@lucent-lang/ui";
import type { Event } from "@lucent-lang/events";

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

| Primitive          | Props                                              | Children                 |
| ------------------ | -------------------------------------------------- | ------------------------ |
| `VStack`, `HStack` | `padding`, `spacing` in logical units              | native views             |
| `Text`             | `size`, `color` (`#RRGGBB`)                        | strings/numbers/booleans |
| `Spacer`           | `size` (default 8)                                 | none                     |
| `Divider`          | none                                               | none                     |
| `Button`           | required `title`, optional `onPress: Event<void>`  | none                     |
| `For`              | required `each: string[] \| number[] \| boolean[]` | one row closure          |

View props support string, number, boolean, arrays of those, nullable scalars,
and events. A conditional expression may choose between two views or two values
of the same type. `For` lays rows out eagerly in array order; the index is not
a stable identity across insertions. Compose other imported `.lucent.tsx`
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

`LC3002` warns about loops, recursion, and bindings marked `cost: "cpu" | "io"`
reached from `@MainThread`, including calls through private helpers. Explicit
background hops stop propagation. Warnings are retained on incremental cache
hits and do not fail builds. This is conservative static analysis, not a
runtime duration guarantee.

## Native libraries and memory

| Package                        | APIs                                                       | Capability   |
| ------------------------------ | ---------------------------------------------------------- | ------------ |
| `@lucent-lang/core`            | `encodeUTF8`, `decodeUTF8`, `copyBytes`                    | none         |
| `@lucent-lang/filesystem`      | async `read`, `write`, `exists`, `temporaryDirectory`      | `filesystem` |
| `@lucent-lang/crypto`          | `sha256(bytes)` → lowercase hexadecimal                    | `crypto`     |
| `@lucent-lang/network`         | async `get(url)` → response bytes                          | `network`    |
| `@lucent-lang/device`          | async `model()`                                            | `device`     |
| `@lucent-lang/core/math`       | `abs`, `sqrt`, `floor`, `ceil`, `sin`, `cos`, `min`, `max` | none         |
| `@lucent-lang/core/text`       | `trim`, `contains`                                         | none         |
| `@lucent-lang/platform/clock`  | Unix milliseconds `now()`                                  | `clock`      |
| `@lucent-lang/platform/locale` | `languageTag()`                                            | `locale`     |

```ts
import { read } from "@lucent-lang/filesystem";
import { sha256 } from "@lucent-lang/crypto";

@Background
export async function hashFile(path: string): Promise<string> {
  return sha256(await read(path));
}
```

Filesystem and network I/O hop to a worker context. Device model queries use
the main context. Hashing is synchronous; use `@Background` around expensive
work. Filesystem paths refer to the application's native sandbox. GET accepts
HTTPS, has a 30-second request/read timeout, and rejects non-2xx responses with
`HTTP_ERROR` and `metadata.status`. Transport errors use `NETWORK_ERROR`;
file errors use `FILE_READ` / `FILE_WRITE` with `metadata.path`. Cancellation,
streaming, uploads, and arbitrary request customization are not exposed yet.

Native library results own their bytes. Swift adapters use `Data`; Kotlin uses
`ByteArray` / direct `ByteBuffer`. JS input buffers are copied for async calls
before native work outlives the call. Synchronous access may borrow through the
host SDK; `copyBytes` always creates independent storage. Empty buffers and
UTF-8 are supported. No binary payload is serialized through JSON. Do not
mutate or detach a borrowed input during a synchronous native call.

```ts
export function fail(path: string): void {
  throw new LucentError("MISSING", {
    message: "File not found",
    metadata: { path, attempt: 1, retry: false, detail: null },
  });
}
```

## Typed capabilities

An app can use `lucent.config.ts`:

```ts
import { defineNativeConfig } from "@lucent-lang/config";
export default defineNativeConfig({
  capabilities: {
    camera: { reason: "Scan documents" },
    location: { whenInUse: { reason: "Show nearby stores" } },
    filesystem: true,
    crypto: true,
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
for the APNs entitlement. Core library permissions take booleans. Unknown
capability names in the typed form fail the build.

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
import { Platform } from "@lucent-lang/platform";
import { homeDirectory } from "@lucent-lang/sdk/foundation";

export function home(): string {
  if (Platform.OS === "ios") {
    return homeDirectory();
  }
  return "";
}
```

Bindings declare `platforms: ["ios"]` or `["android"]`. `LC2004` rejects calls
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
import { defineNativeConfig } from "@lucent-lang/config";
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
constructors, properties, and methods. Give overloaded SDK methods distinct
Lucent names to select their native signatures explicitly. The text-based SDK
extractors still report unsupported class declarations; this does not provide
automatic instance-method overload selection or complete SDK metadata extraction.

Compiled functions can be passed to other native functions using
`NativeCallback`:

```ts
import type { NativeCallback } from "@lucent-lang/types";

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
string, number, or boolean array.

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

## Versioned native contracts and overloads

Binding libraries may set `schemaVersion: 1`. Unsupported schema versions and
invalid contract metadata produce `LC1006`. Native bindings can attach a
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

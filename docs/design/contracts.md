# Native platform contracts

Lucent's native platform work is split across bindgen, the compiler, the
C++ runtime, the React Native hosts and the CLI. Where two or more of those
parts meet, they implement against a shared interface: a contract. This
document is the reference for every contract, with its current text and
its history. The contracts back the plan in [ROADMAP.md](../../ROADMAP.md).
The design they implement is in [native-platform.md](native-platform.md),
the view runtime in [views.md](views.md), the observable semantics in
[semantics.md](../semantics.md), and the code layout in
[architecture.md](../architecture.md).

Each contract has a name (C-BIND, C-IR, …), a version, and a status:

- **Frozen**: implemented and relied on by more than one part.
- **Proposed**: written by the task that implemented it, and used by the
  code, but not yet formally frozen.
- **Superseded**: replaced by a later revision, or by what shipped
  instead. Superseded text appears only in the revision lists, never as
  current text.

A change to a contract needs a new revision and a migration note. Each
contract section gives its current version and status first, then its
current text, then its revisions in version order. A revision names the
plan task that introduced it (T13, TB3, T36 and so on, as in the
roadmap). Where the code and a contract's text disagree, the section says
so; the code is what runs.

## Summary

| Contract | Purpose                                                                         | Current version | Status                             | Main code location                                                                                  |
| -------- | ------------------------------------------------------------------------------- | --------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| C-BIND   | Binding schemas: format, native identity, provenance, facts, binding plans      | v1.5            | v1.2 frozen; v1.3 to v1.5 proposed | `packages/bindgen/src/schema.ts`, `binding-plan.ts`, `usage.ts`, `source-plan.ts`                   |
| C-IR     | Semantic IR, its verifier, effect summaries, program facts                      | v1.3            | v1.2 frozen; v1.2.1, v1.3 proposed | `packages/compiler/src/ir/`, `packages/compiler/src/analysis/`                                      |
| C-EXEC   | Runtime identities, scopes, operations, contexts, transport, compute, callbacks | v1.6            | v1.5 frozen; v1.6 proposed         | `packages/runtime/cpp/lucent/` (`scope.h`, `execution.h`, `transport.h`, `compute.h`, `callback.h`) |
| C-BIGINT | The runtime's `BigInt` and its native integer conversions                       | v1.1            | v1 frozen; v1.1 proposed           | `packages/runtime/cpp/lucent/bigint.h`                                                              |
| C-BUFFER | Native buffers, borrows and transfers                                           | v1.1            | Proposed                           | `packages/runtime/cpp/lucent/buffer.h`, `lucent:core`                                               |
| C-VIEW   | Component descriptions, mounts, platform hosts, toolkit bodies                  | v2.2            | Proposed                           | `packages/compiler/src/ui/contract.ts`, `packages/runtime/cpp/rn/`                                  |
| C-BUILD  | Build records, required actions, SDK locks, build identities                    | v1.5            | v1 frozen; v1.1 to v1.5 proposed   | `packages/lucent/src/cli/build-graph.ts`, `pipeline.ts`; `packages/compiler/src/emit/identity.ts`   |
| C-TRACE  | Correlated runtime and build tracing                                            | v1              | Proposed                           | `packages/runtime/cpp/lucent/trace.h`, `packages/lucent/src/cli/trace.ts`                           |
| C-EXT    | Typed native extensions: C libraries a Lucent package declares                  | v1              | Proposed                           | `packages/runtime/cpp/lucent/extension.h`, `lucent.json` `extensions`                               |

## Cross-cutting rules

These hold for every contract.

- **No curated catalog.** Behavior is never selected by an SDK or
  library class, method, module or package name. A small set of fixed
  ABI and platform fundamentals is allowed (see
  [Fixed platform fundamentals](#fixed-platform-fundamentals)); everything
  else comes from metadata, from general type rules, or from an explicit
  adapter a package authors. A test inventory is never an allowlist.
- **Unknown stays unknown.** Every fact defaults to `unknown`, and nothing
  is inferred from a name. Consumers treat unknown conservatively: an
  absent fact is never "safe".
- **One error path.** Internal invariant violations throw: an `Error`
  subclass in TypeScript, an exception or `reportUncaught` in C++.
  Problems in user code are `LUCENT` diagnostics, each with an allocated
  code; an unsupported feature fails with a diagnostic, never with
  invalid C++.
- **Portable identities.** Hashed identities (schema provenance, build
  record nodes, build identities, component identities) never contain
  machine-specific absolute paths. A path needed for a message is kept in
  a separate, unhashed field.
- **Generated C++.**
  - It never depends on unspecified evaluation order: every operand
    with an effect is sequenced explicitly.
  - A coroutine never references lambda captures.
  - JSI objects stay on the JavaScript thread; other threads refer to
    them through `Host` ids.
  - Every build of Lucent C++ passes `-ffp-contract=off`, because
    JavaScript rounds `a * b + c` twice and a fused multiply-add would
    not.
- **JavaScript semantics are the reference.** A deviation of native
  behavior from the same source run as JavaScript needs a documented
  reason in [semantics.md](../semantics.md).

## C-BIND: binding schemas and plans

**Current version: v1.5 (proposed).** v1.2 is the last frozen revision.
v1.3, v1.4 and v1.5 are additive and implemented; none of them changed
`SCHEMA_FORMAT`.

C-BIND is what bindgen produces and the compiler consumes: the schema of
a platform SDK module (its declarations as data), the native identity and
provenance of each declaration, the facts metadata proves about it, and
the binding plan that says how one use of a member crosses the boundary.

### Schema envelope and versioning

- `schema.ts` exports `SCHEMA_FORMAT = 1`. `SdkModuleSchema.format` holds
  the format the extractor wrote. Every loader checks it: the cache,
  fixtures, and hand-written schemas (through `loadSchema`).
- The cache key includes the extractor's identity (`extractorVersion()`,
  a hash of its code) and `SCHEMA_FORMAT`. A cached schema of another
  format is a cache miss and is extracted again, never an error.
- A schema from outside the cache in a missing or unsupported format is
  refused by `loadSchema` with
  `<module>: unsupported binding schema format <N>; this Lucent reads format 1`.
  A missing format prints as `none`, and a schema without a module name
  as `<unknown module>`.
- Hand-written test schemas carry `format: 1`, or go through a helper
  that stamps it.
- A change to the schema types that older schemas would be read wrongly
  under bumps `SCHEMA_FORMAT`. Additive fields do not: the extractor
  hash in the cache key re-extracts caches when the extractor changes.
- `canonicalSchema` puts a schema in canonical order: types, members,
  functions and constants by name, then by native symbol. Extraction
  order varies between runs; declarations and overload indexes must not.
  Order that carries meaning stays: enum cases, struct fields,
  parameters.

### Symbol identity

A declaration's native identity is separate from the name Lucent prints
for it.

- `type SymbolId = string`, with a scheme prefix, derived only from
  native identity, never from the printed TypeScript name:
  - `swift:<USR>`, `objc:<USR>` or `c:<USR>`, from symbol graphs
    (`identifier.precise`). Swift USRs start with `s:`, Clang ones with
    `c:`.
  - `jvm:<internal/Name>` for a JVM class;
    `jvm:<internal/Name>#<name><descriptor>` for methods and constructors
    (`<init>`); `jvm:<internal/Name>#<field>:<descriptor>` for fields.
- `symbol?: SymbolId` is optional on `SdkClassSchema`, `SdkEnumSchema`,
  `SdkStructSchema`, `SdkMethodSchema`, `SdkPropertySchema`,
  `SdkCallable` (constructors), and C functions and constants. A producer
  that knows a symbol must set it.
- A declaration is identified by `(artifact, symbol)`: two artifacts may
  contain the same `SymbolId`.
- A call site is identified by `(artifact, owner symbol, member symbol)`.
  A member that a protocol extension synthesizes on several conforming
  types keeps the extension's symbol, and an Android Kotlin-style
  property shares its getter's symbol, so the declaration alone does not
  identify the member on its owner.
- Generic and inherited members keep the declaring symbol's id.

### Provenance

```ts
/** Where a schema's declarations come from. No machine paths: it is an identity. */
export interface SchemaProvenance {
  /**
   * The artifact's build-system identity, not a display name:
   * `sdk:iphonesimulator27.0`, `pod:OrbitKit@1.2.0`,
   * `maven:dev.orbit:tracking:1.0.0`, `android-sdk:35`, `clang-module:M`.
   */
  artifact: string;
  kind: "sdk" | "framework" | "clang-module" | "swift-module" | "jar" | "aar" | "sources";
  /** A hash of the artifact's declaration inputs' contents, when known. */
  contentHash?: string;
  /** What the declarations were read for: `arm64-apple-ios15.1-simulator`, `android-35`. */
  target: string;
  /** The extractor's identity (its code's hash), as cache keys use it. */
  extractor: string;
}
```

- `SdkModuleSchema.provenance?: SchemaProvenance` describes the module's
  own artifact. There is one provenance per module.
- What reading a schema depended on (the other artifacts resolution
  consulted) is exposed by bindgen (`sdkModuleArtifacts`, the cache
  entry's `inputs`) rather than stored in the schema.
- `contentHash` hashes the declaration inputs as the artifact defines
  them. For an Android class archive that is the class entries (name and
  CRC); for `android.jar` the artifact hash also covers the API-version
  and annotation files.
- Gradle-transformed jars are identified as `jar:classes.jar`; the
  content hash tells them apart.

### Native facts

```ts
/** A fact, or `unknown`: what metadata does not prove stays unknown. */
export type Known<T extends string> = T | "unknown";

export interface NativeFacts {
  affinity: Known<"main" | "worker" | "any">;
  blocking: Known<"yes" | "no">;
  /** Only meaningful on function-typed parameters and properties. */
  callbackTiming?: Known<"during-call" | "escaping">;
  ownership: Known<"borrowed" | "retained" | "transferred">;
  evidence: FactEvidence[];
}

export interface FactEvidence {
  fact: "affinity" | "blocking" | "callbackTiming" | "ownership";
  /** Where the fact came from; a `convention` names a general rule, never a library. */
  source: "annotation" | "attribute" | "metadata" | "abi" | "convention";
  /** The annotation or attribute (`@WorkerThread`, `@MainActor`), or the rule's name. */
  detail: string;
}
```

- `facts?: NativeFacts` is optional on methods, properties, constructors
  and functions. `SdkClassSchema.facts?` applies to the members that do
  not have their own.
- Absent `facts` means all facts are unknown, never "safe".
- Mapping of thread annotations:
  - `@WorkerThread`: `affinity: "worker"`, `blocking: "unknown"` (it does
    not prove blocking).
  - `@MainThread`, `@UiThread`, `@MainActor`: `affinity: "main"`,
    `blocking: "unknown"`.
  - `@AnyThread`: `affinity: "any"`.
- The older `mainActor` and `worker` flags stay, for their existing
  consumers. Both the flags and the facts come from the same extraction
  step, so they cannot disagree; a unit test asserts the mapping.
- Ownership comes from general naming conventions, with evidence naming
  the rule: `objc-method-family` (Objective-C `alloc`/`new`/`copy`/
  `mutableCopy` families) and `cf-create-rule` (CoreFoundation's
  Create/Copy rule for C functions).
- Callback timing is recorded per callback value, not per member: on each
  `callback` conversion plan, `detail` is `during-call` or `escaping`,
  followed by `, main thread` when the block runs on the main thread.

### Kotlin and Swift facts

Kotlin metadata and Swift symbol graphs say things class files and
Objective-C headers do not. These facts are additive and optional.

```ts
/** A Swift-only type (a struct, class, enum or protocol), called through generated shims. */
export interface SwiftType {
  kind: "struct" | "class" | "enum" | "protocol";
  /** A protocol with associated types or `Self` requirements: its values cross only as arguments. */
  associatedTypes?: boolean;
  /** The associated types `P<A>` names, first among the type parameters. */
  primaryAssociatedTypes?: string[];
  /** An enum's cases, with their payloads (an enum without payloads is an SdkEnumSchema). */
  cases?: { name: string; params: { label?: string; type: SchemaType }[] }[];
  /** A property wrapper (`@propertyWrapper`: Binding, State). */
  propertyWrapper?: true;
}

/** A Swift-only member, called through a generated shim. */
export interface SwiftMember {
  /** How Swift names it (`distance(to:)`, `init(x:y:)`, `x`). */
  name: string;
  async?: boolean;
  throws?: boolean;
  mutating?: boolean;
  /** `bytes` of a ContiguousBytes type: its bytes, copied out. */
  bytes?: boolean;
  /** A static member of a generic type, on the type arguments its extension fixes. */
  ownerArgs?: SchemaType[];
}

/** How Swift source passes an argument (members of a `source` module). */
export interface SwiftParamFacts {
  /** Swift's argument label; none for an unlabeled (`_`) parameter. */
  label?: string;
  /** `value`: an expression; `action`: a closure native code calls back; `builder`: a result builder's closure. */
  kind: "value" | "action" | "builder";
}

/** What Kotlin metadata says of a class that its class file does not. */
export interface KotlinClassFacts {
  kind:
    | "class"
    | "interface"
    | "enum"
    | "annotation"
    | "object"
    | "companion"
    | "file-facade"
    | "multi-file-facade";
  data?: true;
  /** A `fun interface`: a lambda implements its one abstract function. */
  fun?: true;
  /** A sealed class or interface: its direct subclasses, as type references. */
  sealed?: string[];
  /** A value class: the property holding its underlying value, and that value's type. */
  value?: { property: string; type: SchemaType };
  bounds?: TypeParamBounds;
  /** The receiver of a lambda parameter of the API (`BoxScope`). */
  scope?: true;
  /** Its name is a value of its own type: its companion object is one (`Modifier`). */
  companionValue?: true;
}

/** Bounded type parameters: `non-null` (`T : Any`) or `other` (`T : Comparable<T>`). */
export type TypeParamBounds = Record<string, "non-null" | "other">;

/** What Kotlin metadata says of a member that its JVM method does not. */
export interface KotlinMemberFacts {
  /** `params` leave out the Continuation; `returns` is what it completes with. */
  suspend?: true;
  /** An extension function or property accessor: `params[0]` is its receiver. */
  extension?: true;
  /** Takes or gives a value class that the JVM passes as its underlying value. */
  unboxed?: true;
  bounds?: TypeParamBounds;
  /** An extension property, read from its receiver (`params[0]`): `20.dp`. */
  property?: true;
  /** Compose's `@Composable`. */
  composable?: true;
  /** The applier it emits nodes into; `*` for its caller's; none for composables emitting nothing. */
  applier?: string;
  inline?: true;
  reified?: string[];
  /** The opt-in markers of an experimental API. */
  optIn?: string[];
  /** `@RestrictTo`: for its own library group only. */
  restricted?: true;
  /** Left empty, its vararg would call another overload. */
  varargShadowed?: true;
  /** Defaulted parameters `params` leave out, of types content cannot write. */
  omits?: string[];
  /** The receiver scope it runs in (`androidx.compose.foundation.layout.ColumnScope`). */
  scope?: string;
}

/** What Kotlin metadata says of a parameter. */
export interface KotlinParamFacts {
  /** Declares a default: a Kotlin shim may leave it out; JNI passes every argument. */
  default?: true;
  /** A suspend function, typed as Kotlin declares it rather than its lowered JVM form. */
  suspendFunction?: true;
  /** A function-typed parameter: a `@Composable` one is `content`, any other a `callback`. */
  role?: "content" | "callback";
  /** A lambda with a receiver: the receiver's type. */
  receiver?: SchemaType;
  /** `vararg`: `type` is an element's. */
  vararg?: true;
  /** The receiver's member that makes a lambda's result from a function (`onDispose`). */
  returnsThrough?: string;
  /** A value whose changes the callback parameter of this name reports (`value` and `onValueChange`). */
  changedBy?: string;
}
```

Where these attach:

- `SdkClassSchema.swift?: SwiftType`, `SdkClassSchema.kotlin?:
KotlinClassFacts`.
- `SdkCallable.swift?` and `SdkPropertySchema.swift?: SwiftMember`;
  `SdkCallable.kotlin?` and `SdkPropertySchema.kotlin?:
KotlinMemberFacts`.
- `SdkParam.kotlin?: KotlinParamFacts`, `SdkParam.swift?:
SwiftParamFacts`.
- `SdkParam.defaulted?: "optional" | "omitted"`: a Swift default the call
  may leave out (the shim does), or one Lucent never gives (no Lucent
  value for its type). A Kotlin `declaresDefault` maps to
  `kotlin.default`.
- `SdkMethodSchema.java?`: the JVM method name when it is not `name`
  (overload renaming, `@JvmName`, value-class mangling such as
  `load-X6dG1pw`). `SdkPropertySchema.setter?`: an Objective-C setter
  selector, or an Android (Kotlin) setter method.
- A Kotlin `suspend` function also sets `SdkMethodSchema.async` to
  `{ returns, throws: true }`; its symbol keeps the full JVM descriptor.
- Extension functions and properties are static members of their facade
  class (multi-file parts map to their facade), receiver first.
- Nullability maps to the optional `SchemaType`s; Kotlin platform types
  follow the Java rule.
- `SdkEnumSchema.options?: true` marks an option set (`NS_OPTIONS`):
  its cases combine, and 0 is the empty set.

### Schema types for 64-bit integers

- A primitive `SchemaType` of `long`, `NSInteger`, `NSUInteger`, `int64`
  or `uint64` is a bigint in Lucent (`isBigIntType`), unless it carries
  `group: true`.
- `group: true` marks an integer of a constant group (Android `@IntDef`,
  `@LongDef`): it stays a number, as the group's constants are.
  `markGroupIntegers(module)` sets it on the parameters, results and
  properties a group types, and on the module's own constants a group
  names (their value back to a number when it is within 2^53).
- The value of a 64-bit constant (`SdkPropertySchema.value`) is its
  decimal digits, as a string: exact, and safe in JSON.
- `isUnsignedWide(name)` is true for `NSUInteger` and `uint64`. The glue
  takes signedness and range from the real C type
  (`decltype(...)`), not from the schema name, because Swift symbol
  graphs type some unsigned C fields as `Int`.

### Binding and conversion plans

`binding-plan.ts` derives a plan for each use of a member from the schema,
by type and ABI rules. The compiler refuses a use, documents a
declaration, and emits glue from the same plan; coverage counts what plans
refuse.

```ts
export type Backend =
  "objc" | "jni" | "swift-shim" | "kotlin-shim" | "c-abi" | "kotlin-source" | "swift-source";

/** Call, construct, read or write a property, or implement a requirement the platform calls. */
export type Role = "call" | "new" | "get" | "set" | "implement";

/** Into native code (`in`), or out of it to Lucent code (`out`). */
export type Flow = "in" | "out";

export type ConversionOp =
  | "passthrough" // same representation on both sides
  | "number" // JS number <-> native integer or float; `detail` names the native type
  | "bigint" // JS bigint <-> native 64-bit integer; exact, or RangeError
  | "copy-string"
  | "copy-bytes"
  | "copy-array"
  | "copy-record"
  | "copy-set"
  | "copy-date"
  | "retain-object" // a native reference retained by a NativeRef
  | "box-swift-value" // a Swift value type, boxed
  | "optional" // wraps `of[0]`
  | "tagged-union" // a Swift enum with payloads
  | "enum" // a plain enum, as its integer or string
  | "struct" // a C struct, by value
  | "out" // an Out<T> out-parameter
  | "callback" // a trampoline for a function-typed value; `detail` says when it runs
  | "error" // a native error to or from a Lucent Error
  | "unsupported"; // cannot cross: `reason` says why

/** When native code runs a Lucent function: `sync` while it waits, holding the Lucent lock; `queued` later. */
export type Delivery = "sync" | "queued";

export type ErrorConvention = "nserror-out" | "swift-throws" | "java-exception";

export interface ConversionPlan {
  op: ConversionOp;
  type: SchemaType;
  of?: ConversionPlan[];
  detail?: string;
  /** Present exactly when `op` is `unsupported`: the precise, user-facing reason. */
  reason?: string;
  /** A value a use may leave out; its being unsupported refuses only uses that give or take it. */
  omissible?: true;
  /** A callback native code runs: when. */
  delivery?: Delivery;
  /** A constant group's 64-bit integer, which stays a number: exact, or RangeError. */
  exact?: true;
}

/** Why a member cannot be used in its role at all, and the general rule that says so. */
export interface Refusal {
  rule: string;
  reason: string;
}

export interface BindingPlan {
  symbol?: SymbolId;
  /** The member as printed, for messages: `UIDevice.batteryLevel`. */
  display: string;
  backend: Backend;
  role: Role;
  /** The artifact declaring the member (its module's). */
  artifact?: string;
  receiver?: ConversionPlan;
  inputs: ConversionPlan[];
  output: ConversionPlan;
  error?: ConversionPlan & { op: "error"; detail: ErrorConvention };
  refused?: Refusal;
  /** A requirement a Lucent class implements: when the platform's call runs it. */
  delivery?: Delivery;
  facts: NativeFacts;
  availability?: { platform: Platform; since: number | string };
  /** The artifacts to link: the member's, and those of the types it names. */
  requiredArtifacts: string[];
}

/** What a plan needs to know of a type a member names. Unknown facts refuse nothing. */
export interface TypeFacts {
  kind?: "class" | "protocol" | "enum" | "struct";
  cf?: boolean;
  swift?: SwiftType | true;
  typeParams?: number;
  artifact?: string;
}

export type TypeLookup = (module: string, name: string) => TypeFacts | undefined;
export type ModuleLookup = (module: string) => SdkLookup;

export function planMember(owner, member, module, lookup: ModuleLookup, role?: Role): BindingPlan;
export function planBinding(owner, member, module, types: TypeLookup, role?: Role): BindingPlan;
export function planConversion(t, where, types: TypeLookup): ConversionPlan;
export function unsupportedReason(plan: BindingPlan): string | undefined;
export function takenReason(values: ConversionPlan[], taken: number): string | undefined;
export function explainRefusal(plan: BindingPlan): string | undefined;
```

Rules:

- Plans are derived data, never serialized into the schema cache.
- The default role is `new` for a constructor, `get` for a property and
  `call` otherwise.
- Every SDK use in the compiler goes through a plan (`requirePlan`); the
  emitters have no separate use-site checks.
- A type lookup that cannot tell a fact leaves it out, and a rule that
  depends on it does not refuse: unknown facts refuse nothing.
- `omissible` values (a block's or requirement's parameters offered to a
  Lucent function, defaulted arguments) refuse only the uses that give or
  take them, as `takenReason` reports.
- `explainRefusal` appends the native symbol and artifact:
  `` `UIDevice.x: <reason> (<symbol> in <artifact>)` ``.
- Member-level refusal rules include `read-only`, `no-setter`,
  `java-field-write`, `async-initializer`, `associated-types`,
  `static-requirement`, `requirement-effects`, `jvm-mangled-name`,
  `kotlin-shim`, `kotlin-shim-generic`, and, for Kotlin source
  (`kotlin-source`), `kotlin-source-implement`, `kotlin-source-set`,
  `kotlin-reified`, `kotlin-opt-in`, `kotlin-restricted`,
  `kotlin-vararg`, `kotlin-receiver-result`, `kotlin-member-extension`,
  `kotlin-extension-receiver` and `compose-applier`. Each is a general
  rule; none names a library.
- A Kotlin member uses the `kotlin-shim` backend when JNI cannot call it
  as Kotlin declares it: a suspend function, a value class the JVM passes
  unboxed, or a suspend-function parameter.
- A plan's `unsupported` reason equals the reason coverage counts the
  member under; a golden test enforces this.

### SDK usage, locks and diffs

`usage.ts` describes SDK symbols as an app depends on them. Plain data in,
plain data out.

```ts
export const USAGE_FORMAT = 1;

export type SymbolKind = "type" | "constructor" | "method" | "property" | "function" | "constant";

export interface SdkSymbol {
  platform: Platform;
  module: string;
  /** The declaring type's Lucent name; none for types, C functions and constants. */
  owner?: string;
  kind: SymbolKind;
  /** The Lucent name (`setValue_long`); `constructor` for constructors. */
  name: string;
  static?: true;
  symbol?: SymbolId;
  /** What Lucent declares it as: `(string, int) => void`, `string readonly`, `class extends X`. */
  signature: string;
  since?: number | string;
  deprecated?: true;
  /** An enum's case names. */
  cases?: string[];
}

export interface UsedSymbol extends SdkSymbol {
  roles?: Role[];
}

export interface UsedModule {
  /** The artifacts its schema was read from: `id#contentHash`, sorted. */
  artifacts: string[];
  /** Where the SDK cache keeps that schema (`<scope>/<entry>`, no machine paths). */
  schema?: string;
}

/** `.lucent/sdk-usage.json`, and the SDK lock. */
export interface SdkUsage {
  format: number;
  targets: Platform[];
  /** `<platform>/<module>` → how the build read it. */
  modules: Record<string, UsedModule>;
  /** Sorted by key. */
  symbols: UsedSymbol[];
}

export interface SymbolChange {
  change: "removed" | "changed" | "added" | "unchanged";
  before?: SdkSymbol;
  after?: SdkSymbol;
  details: string[];
}
```

- `symbolKey(s)` is
  `` `${platform}/${module}/${owner ?? ""}/${kind}:${symbol ?? `${static ? "static " : ""}${name} ${signature}`}` ``.
  Kind and owner stay in the key, because a getter property and its
  method, or members an extension gives several types, share a symbol.
- `diffSymbols(used, schemaOf)` and `diffModule(before, after)` report
  each used symbol as removed (with why, when its module is gone),
  changed (with the differences in words: owner, TypeScript name,
  static/instance, signature, native symbol, `since`, deprecation, enum
  cases) or unchanged.
- Coverage (`coverage.ts`) counts each member's stage: `discovered`,
  `representable` (its plan can work), `generated` (an app build
  generated code for it), `exercised` (a test or probe ran it). A
  stage without evidence is `null`.
- The lock and usage file formats belong to C-BUILD (v1.3).

### Modules written as source

Some modules are not called through glue: generated Swift or Kotlin
source calls them as its own language would.

- `SdkModuleSchema.form?: "source"` marks such a module: SwiftUI's views,
  modifiers and values (Swift), and Compose's content (Kotlin).
- Swift source modules are built from the symbol graphs of the module
  and its public parts (`@_exported import` of a module whose interface
  says `-public-module-name <module>`, such as SwiftUICore), with
  extension graphs and without synthesized members, and cached like
  other schemas. Structs, enums and protocols are value types; classes
  are left out; initializers are constructors; enum cases without
  payloads and statics are static read-only properties.
- `SdkParam.swift` says how Swift source passes each argument; position
  is the parameter's index. `callForms(params)` in `call-form.ts` is the
  single rule for which argument shapes a call may take.
- A `form: "source"` iOS module is planned by `planSource`
  (`swift-source` backend): inputs pass through (values) or are callbacks
  (`action` or `builder`). Its refusal rules are `property-wrapper` (a
  `Binding` of a type `bind(signal)` cannot give), `builder-arguments`
  (a builder given values), and `role` (set and implement are refused).
- A `form: "source"` Android module uses the `kotlin-source` backend:
  values are Kotlin's own and cross nothing.
- A schema type parameter may carry a `bound` (`tparam` with `bound`):
  the Lucent values it takes when a body written as Swift source gives
  it (`V: Equatable` takes any Lucent scalar).

### Acceptance examples

Tests keep each of these true.

- An Android fixture method annotated `@WorkerThread` yields
  `facts.affinity = "worker"`, `blocking = "unknown"`, and the evidence
  `{ fact: "affinity", source: "annotation", detail: "@WorkerThread" }`.
- A Swift fixture member's `symbol` is `swift:s:…`, equal to its symbol
  graph USR; an Objective-C one is `objc:c:objc(cs)…`.
- Two fixture artifacts exposing the same display name produce distinct
  `(artifact, symbol)` pairs; generic and inherited members keep the
  declaring symbol's id.
- Loading `{ format: 0 }` from the cache re-extracts; passing it to
  `loadSchema` throws the message above.
- `planMember` on a member with an unsupported shape returns an
  `unsupported` plan whose reason matches coverage's.

### Revisions

- **v1** (2026-09-25, T01, frozen): schema format and versioning, symbol
  identity, provenance, native facts with evidence, `BindingPlan` and
  `ConversionPlan` (`planMember`), derived from the existing schema data
  by the emitters' type rules without replacing the emitters. Migration:
  caches re-extract once (new cache key).
- **v1.1** (2026-09-25, T03, frozen):
  - `planMember(owner, member, module, lookup: ModuleLookup)`, where
    `ModuleLookup = (module) => SdkLookup`: v1 named the lookup's result
    type instead.
  - Callback timing is recorded per callback conversion, in `detail`.
  - A missing format prints as `none`.
  - A call site is `(artifact, owner symbol, member symbol)`.
  - One provenance per module.
  - Property plans cover the read.
  - Coverage agreement holds for plan-level rules; extractor-time
    reasons (tuples, pointers, parameter packs) stay coverage reasons.
  - Migration: none (signature fix and clarifications).
- **v1.2** (2026-09-25, T13, frozen):
  - Roles `call | new | get | set | implement`, and
    `planBinding(owner, member, module, types: TypeLookup, role?)`;
    `planMember` keeps `ModuleLookup` through `typesOf`.
  - `TypeFacts { kind, cf, swift, typeParams, artifact }`; unknown facts
    refuse nothing.
  - Member-level `refused { rule, reason }`.
  - Per-value facts `omissible` (with `takenReason`), `delivery`
    (`sync | queued`) and `exact`.
  - The `error` conventions (NSError out-parameter, Swift `throws`,
    Java exception).
  - Ownership from naming conventions, with evidence.
  - `explainRefusal` appends the native symbol and artifact.
  - Every SDK use goes through `requirePlan`; emitter use-site checks
    are removed.
  - Additive `SdkEnumSchema.options`.
  - Its 64-bit rule (results exact within plus or minus 2^53 − 1, a
    RangeError beyond; arguments as WebIDL `[EnforceRange] long long`)
    is superseded by v1.3, under which every native 64-bit integer is a
    bigint.
  - Migration: generated declarations and glue follow the plans.
- **v1.3** (2026-09-25, T16; 2026-09-26, TB3; proposed):
  - Kotlin facts: `KotlinClassFacts` (`kind`, `data`, `sealed`, `value`),
    `KotlinMemberFacts` (`suspend`, `extension`, `unboxed`) and
    `KotlinParamFacts` (`default`, `suspendFunction`).
  - `SdkMethodSchema.java` widened to the JVM name when it is not
    `name`; `SdkPropertySchema.setter` widened to Android setter methods.
  - Backend `kotlin-shim` with refusal rule `kotlin-shim`, and the rule
    `jvm-mangled-name`. (T16 also proposed a `jvm-setter` rule; the code
    has none: Android setters plan through `SdkPropertySchema.setter`.)
  - `ConversionOp` gains `bigint` (`detail`: the native type; exact, or
    a RangeError naming the value).
  - `ConversionPlan.exact` narrows to constant-group 64-bit integers,
    which stay numbers; `SchemaType` primitives gain `group?: true`.
  - `isBigIntType`, `isUnsignedWide` and `markGroupIntegers` are
    exported; 64-bit constant values are decimal strings.
  - This answers v1.2's open question on sentinels such as `NSNotFound`
    and `Long.MAX_VALUE`: they are exact bigints.
  - The structured callback facts requested for v1.3 by T19
    (`callbackTiming` and `main` as fields of `ConversionPlan` instead of
    `detail` text) were not adopted: the code still writes them in
    `detail`.
  - Migration: breaking for Lucent code that passes numbers where an SDK
    integer is 64 bits wide; pass bigints (`1000n`, `BigInt(x)`) and
    convert results with `Number(...)` where a number is wanted.
    `SCHEMA_FORMAT` is unchanged; caches re-extract through the
    extractor hash.
- **v1.4** (2026-09-26, T24, proposed): the usage and diff API of
  `usage.ts` (`SdkSymbol`, `UsedSymbol`, `UsedModule`, `SdkUsage`,
  `symbolKey`, `diffSymbols`, `diffModule`, `compareArtifacts`) and
  coverage stages. Migration: none (additive).
- **v1.5** (2026-09-27, TD3 and TD4, with TD5 and TD7 on 2026-09-28;
  proposed):
  - `SdkModuleSchema.form: "source"` and the `swift-source` and
    `kotlin-source` backends.
  - `SdkParam.swift` (`SwiftParamFacts`) and `SwiftType.propertyWrapper`.
  - `KotlinClassFacts` gains `scope` and `companionValue`.
  - `KotlinMemberFacts` gains `property`, `composable`, `applier`,
    `inline`, `reified`, `optIn`, `restricted` and `scope`; TD4 adds
    `varargShadowed` and TD5 adds `omits`.
  - `KotlinParamFacts` gains `role`, `receiver`, `vararg` and
    `returnsThrough`; TD5 adds `changedBy`.
  - `tparam` gains `bound`.
  - TD4 proposed `SdkModuleSchema.calledFrom?: "kotlin"`; it shipped as
    `form: "source"`, shared with Swift.
  - TD3's source rules `builders` and `action-arguments` were lifted by
    TD7; the remaining source rules are listed above.
  - Migration: none (additive).
- **Not adopted.**
  - T07's proposed Kotlin extension (`jvmSetter`,
    `SdkClassSchema.kotlin.{companion, valueClass}`,
    `SdkMethodSchema.kotlin.{receiver, synthesized}`) is superseded by
    v1.3's Kotlin facts.
  - T11's proposed per-type provenance (`SdkClassSchema.artifact`, only
    where it differs from the module's) was not implemented: plans take
    a type's artifact from its module's provenance (`TypeFacts.artifact`).

## C-IR: semantic IR and program facts

**Current version: v1.3 (proposed).** v1.2 is frozen.

C-IR is the compiler's semantic intermediate representation and the
analysis contract later tasks consume. Values are defined once by an
operation and referred to by id; operations run in the order of their
region's list, so evaluation order is data rather than something a
printer or a C++ compiler decides.

### Placement and selection

- `packages/compiler/src/ir/`: `ir.ts` (data), `build.ts` (builder
  helpers), `lower.ts` (TypeScript AST to IR for the supported subset),
  `verify.ts`, `dump.ts`, and `cpp.ts` (IR to the C++ AST of
  `@lucent-lang/codegen`). Tests live in `packages/compiler/test/ir/`.
- The IR imports `types.ts` (`LType`) and `typescript`; it never imports
  `emit/**`. The emitter reaches `ir/cpp.ts` through one hook,
  `emit/through-ir.ts`, for functions, methods, accessors and
  components' setups; a closure's
  leaves see `this` as the `self` it captures (`LowerHost.nested`,
  `self`, `siteOf`).
- Every function, method, accessor, constructor, module `init()` and
  compute task variant lowers through the IR; what it cannot lower is a
  LUCENT diagnostic (`LUCENT1001`), never invalid C++ and never a runtime
  JavaScript fallback; so does each component's setup. The `LUCENT_LOWERING` selector of the migration is
  gone.

### Data model

```ts
export type ValueId = number & { readonly __value: true }; // dense per function
export type RegionId = number & { readonly __region: true }; // dense per function
export type PlaceId = number & { readonly __place: true }; // a local or module variable
export type TargetId = number & { readonly __target: true }; // a loop or block break/continue names
export type FunctionId = string; // the function's C++ name

export interface SourceSpan {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

/** The execution context a value belongs to, or that runs a unit. */
export type OwnerId = "legacy-module" | "main" | "task" | "unknown";

export type IntKind = "i32" | "u32" | "i64"; // an exact integer's register

export interface IrValue {
  id: ValueId;
  type: LType;
  source: SourceSpan;
  owner?: OwnerId;
}

/** A module variable the function reads or writes. */
export interface IrModulePlace {
  place: PlaceId;
  symbol: string; // its C++ name
  name: string;
  type: LType;
  mutable: boolean;
}

export interface IrFunction {
  id: FunctionId;
  params: ValueId[];
  result: LType;
  body: RegionId;
  values: IrValue[];
  regions: IrRegion[];
  modulePlaces: IrModulePlace[];
  effects: EffectSummary;
  source: SourceSpan;
  async: boolean;
}

export interface IrRegion {
  id: RegionId;
  ops: IrOp[];
  parent?: RegionId;
}

export type Constant = number | bigint | string | boolean | null | undefined;
export type UnaryOp = "-" | "!" | "~" | "!!" | "typeof" | "String";
export type EqualityOp = "===" | "!==" | "==" | "!=";
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | ">>>"
  | "<"
  | ">"
  | "<="
  | ">="
  | EqualityOp;

export type IrOp =
  | { kind: "const"; result: ValueId; value: Constant; source: SourceSpan }
  | { kind: "param"; result: ValueId; index: number; source: SourceSpan }
  | { kind: "unary"; result: ValueId; op: UnaryOp; operand: ValueId; source: SourceSpan }
  | {
      kind: "binary";
      result: ValueId;
      op: BinaryOp;
      left: ValueId;
      right: ValueId;
      source: SourceSpan;
    }
  | { kind: "convert"; result: ValueId; input: ValueId; to: LType; source: SourceSpan }
  | { kind: "local"; place: PlaceId; type: LType; name: string; source: SourceSpan }
  | { kind: "load"; result: ValueId; place: PlaceId; source: SourceSpan }
  | { kind: "store"; place: PlaceId; value: ValueId; source: SourceSpan }
  | {
      kind: "call";
      result?: ValueId;
      callee: Callee;
      args: ValueId[];
      effects: EffectRef;
      source: SourceSpan;
    }
  | {
      kind: "if";
      result?: ValueId;
      cond: ValueId;
      whenTrue: RegionId;
      whenFalse: RegionId;
      source: SourceSpan;
    }
  | { kind: "loop"; target: TargetId; body: RegionId; next?: RegionId; source: SourceSpan }
  | { kind: "block"; target?: TargetId; body: RegionId; source: SourceSpan }
  | { kind: "return"; value?: ValueId; source: SourceSpan } // terminator
  | { kind: "throw"; value: ValueId; source: SourceSpan } // terminator
  | { kind: "break"; target: TargetId; source: SourceSpan } // terminator
  | { kind: "continue"; target: TargetId; source: SourceSpan } // terminator
  | { kind: "yield"; value?: ValueId; source: SourceSpan } // ends an `if` branch
  | {
      kind: "plan";
      result?: ValueId;
      name: string; // what it does, for dumps
      code: unknown; // the backend's, naming its operands
      args: ValueId[];
      source: SourceSpan;
    }
  | {
      kind: "iterate"; // for … of: body runs per element, which it defines
      target: TargetId;
      iterable: ValueId;
      element: ValueId;
      body: RegionId;
      source: SourceSpan;
    }
  | {
      kind: "try"; // the finally runs however the body and the catch are left
      body: RegionId;
      catch?: { region: RegionId; error: ValueId };
      finally?: RegionId;
      source: SourceSpan;
    }
  | { kind: "dispose"; value: ValueId; code: unknown; source: SourceSpan } // in a finally
  | {
      kind: "closure";
      result: ValueId;
      fn: IrFunction;
      from: CaptureSource[];
      enters?: ValueId; // a mount (`{ k: "mount" }`) it enters whenever it runs
      source: SourceSpan;
    }
  | { kind: "await"; result?: ValueId; promise: ValueId; source: SourceSpan } // async only
  | { kind: "produce"; value: ValueId; source: SourceSpan } // a generator's `yield`
  | { kind: "unreachable"; source: SourceSpan } // terminator
  | { kind: "never"; result: ValueId; source: SourceSpan }; // what never completes gives

export type CaptureSource = { value: ValueId } | { box: PlaceId };

export type Callee = { kind: "function"; id: FunctionId } | { kind: "builtin"; name: BuiltinName };

export type Throws = "no" | "yes" | "unknown";

export interface EffectRef {
  throws: Throws;
  summary?: FunctionId;
}
```

- `convert` is a change of representation only, planned by
  `lowering/conversions.ts`. JavaScript's ToString and ToBoolean are the
  unary ops `String` and `!!`; `typeof` gives the type's name.
- `==` and `!=` apply only to operands of the same primitive type, or
  against `null` or `undefined`.
- Union narrowing is tests (`typeof`, equality) plus a checked `convert`
  where the checker narrows; there is no separate `select` op.
- A `plan` is an operation the IR does not model itself: a member read
  or write, a method of the runtime or the SDK, a construction, a literal
  of an array or object, a conversion `convert` does not cover. Lowering
  asks the backend for it through `LowerHost.leaves` (`LeafHost`), which
  lowers the subexpressions the leaf takes as operands, each once, in
  source order (a request out of order is unsupported), before the plan:
  so a plan runs none of the program's code and decides no order. An
  assignment, compound assignment or increment of a place that is not a
  variable asks for the place (`LeafHost.place`): its operands, a read
  plan and a write plan, with the read before the right side runs.
  An optional chain is lowered link by link (`LeafHost.link`): at a `?.`
  whose value is null or undefined, an `if` gives undefined and the rest
  of the chain (its arguments too) does not run. The C++ backend (`emit/leaf.ts`) plans a leaf with the emitter's
  own code for it, its operands being named values, so the semantics of
  builtins and SDK calls are written once.
- A `closure` makes a function value of a nested `IrFunction` (an arrow,
  a function expression, a nested function declaration), lowered on its
  own. Its `captures` are places declared at entry: a copy of a value of
  the enclosing function (taken when the closure is made), or, for a
  variable some code writes after closures capture it (`isBoxed`), the
  enclosing function's box, which they share. A `local` op says when its
  place is `boxed`. Nested function declarations are boxed locals from
  the start of their block, defined there (or where written, when they
  capture a variable the block declares); a `for` loop's boxed `let`
  variables get a copy per iteration, as in JavaScript: a `renew` op
  gives the place a box of its own, holding its value, before the
  first iteration (when the initializer makes closures) and before
  each incrementor, which steps the new copy, even when the body
  assigns the variable (CreatePerIterationEnvironment).
- A function's ambients (`LowerInput.ambient`) are values its backend
  declares around it (a component setup's mount): code reads one where a
  leaf asks for it (`LeafOperands.ambient`), as a capture of the
  function, and of each closure on the way, by its name. A closure made
  in a setup `enters` its mount (`LowerHost.enters`), so whoever calls
  it, the mount's host hears that its code ran.
- A thunk (`LeafOperands.thunk`) is a closure the IR makes of an
  expression a leaf runs later (a toolkit body's value slot, each time
  its effect runs): it takes the parameters `Thunk.params` names, gives
  `Thunk.type`, and computes `Thunk.given` first, in order, for what the
  expression reads of a helper view's props. Its code may come from
  elsewhere than the function making it (a helper's), which
  `IrFunction.elsewhere` lists and the verifier accepts spans in.
  Making a function runs none of its code, so thunks are made in any
  order; and a `const`, like a literal or an unassigned parameter, is
  pure for a plan's operand order.
- `iterate` is `for … of`: its body runs for each element of an array,
  set, map, record, string (code points), byte array, regular expression
  match or iterator (`elementOf`), which it defines for the body alone;
  `break` and `continue` name its target, and leaving early closes an
  iterator. `for … in` iterates the keys the backend lists
  (`LeafHost.keys`). Destructuring (declarations, parameters, loop heads
  and assignments) reads each part through `LeafHost.part` and applies a
  default only when the part is undefined; an assignment's targets are
  evaluated in order, each before the part it gets.
- A number value may be an exact integer of an `IntKind` (`IrValue.int`):
  an integer literal, an int32 operator's result, a read of a local the
  host's analysis proves always holds one (`local.int`, `LowerHost.
integers`: its int locals, and `for` counters as int64s), or a plan's
  integer form (`Math.imul`). The C++ backend keeps such values in integer
  registers and converts to a double where one is needed; a leaf sees an
  operand's integer form too. Reads of a local nothing can write before
  their last use are spelled as the variable (no copy), `s = s + x` on a
  string appends in place (a field's or a module variable's `+=` too,
  through `lucent::appendTo`: the place lets go of its handle, so the
  string read from it grows in place), a chain of string `+`s (a template
  literal) is one `lucent::concat`, sized before it allocates, a comparison
  of two exact integers (a counter and a `length`) compares their
  registers, a `for … of` whose body cannot change its collection (no
  call, plans that only read) reads each element where the collection
  holds it (a `const&`, a map entry a tuple of references), and a pure
  operation used once by the next is written inline there. Each call stays a statement of its own.
- An async function (`IrFunction.async`) returns what its promise
  fulfils with; each `await` is a suspension point of its own, so what
  runs before and after it is explicit, and returning a promise returns
  what it fulfils with. A generator (`IrFunction.generator`, its element
  type) gives each element with `produce`; `yield* xs` iterates `xs`,
  producing each element. An async function with no `await` is not a
  coroutine: its body runs to its end when called (as a coroutine's would,
  its initial suspend never suspending), so it returns its promise
  settled, `Promise::resolved(v)`, or `rejected` with what it threw. Their
  C++ is otherwise a coroutine: `co_await`,
  `co_yield`, `co_return`, a body that only throws still being one, an
  async closure's captures passed to its coroutine as parameters (a
  coroutine frame must not reference a lambda's captures), and no
  suspension inside a C++ catch handler (a catch region runs after it).
- `unreachable` ends a body TypeScript proved always returns (an
  exhaustive switch at its end); a body that may give undefined gives it.
  A call that never returns gives a `never` value, which converts to any
  type and which no code that runs uses.
- A constructor (`LowerInput.construct`) stores its `Initializer`s
  (parameter properties, field initializers, an Error's name) where it
  starts, or, with a Lucent base class, right after its `super(…)`
  (`LeafHost.superCall`); its span is its class's. A module's `init()`
  (`lowerInit`) stores its classes' static fields and its variables in
  source order, one without a value getting its type's default. The
  constructor a class does not declare is the same kind of code: its
  parameters, its base's construction on them, then its fields; an Error
  subclass's forwards its message to Error (`constructorOf`).
- A compute task's variant (`LowerInput.task`) is its function lowered
  again: each loop iteration starts with a safepoint
  (`LeafHost.safepoint`), and its calls of module functions call their
  variants, which the backend names.
- A platform test (`PLATFORM === "ios" && …`, `switch (PLATFORM)`, a
  guard clause) is decided by the host (`platformGuard`,
  `platformClauses`, `runsHere`): only what the platform being built runs
  is lowered, and a build for neither platform throws where platform code
  would run.
- `try` makes exceptional edges explicit: its `catch` region gets the
  error (`error`, defined for the region alone), and its `finally` runs
  however the body and the catch are left. A return, break or continue
  past a finally runs the finally first and then continues; a finally
  that leaves (a return in it) replaces what left. Outside a `try`, an
  exceptional exit (a throwing call, a plan, or `throw`) leaves every
  region to the caller. `throw` takes an Error or an object of a class
  deriving from it, which keeps its class. A `using` declaration is a
  `try` whose `finally` disposes the value (`dispose`, valid only in a
  finally region): disposing that throws while an exception is pending
  makes the pending one a SuppressedError of both, as in JavaScript.

### Verifier invariants

`verify(fn, env?: VerifyEnv)` checks these; a violation throws
`IrVerifyError` (an internal compiler error carrying the dump), never
producing C++. Negative fixtures build malformed IR directly.

```ts
export interface VerifyEnv {
  signature?(id: FunctionId): Signature | undefined;
  /** A callee's effect summary, when the program's analysis knows it. */
  effects?(id: FunctionId): EffectSummary | undefined;
}
```

1. Every operand `ValueId` is defined by an earlier op in the same region
   or an enclosing one (definition dominates use), and each id is
   defined once. Values and locals are scoped to their region.
2. Operand and result types agree with the op: numeric binary ops on
   numbers, a `convert`'s target equals its result type, a call's arity
   and argument types match the callee's signature when known, and a
   `return`'s type equals the function's result. Conditions are boolean.
3. Terminators (`return`, `throw`, `break`, `continue`, `yield`) are last
   in their region. A function body that can complete (fall off the end)
   has a result type of `void`, `undefined` or `never`; a loop no `break`
   leaves never completes.
4. Every op and value has a source span inside the function's span.
5. Evaluation order is the op order. There are no nested expressions:
   an argument is always a `ValueId`, so `combine(next(a), next(b))` is
   three ordered calls, and the C++ adapter emits each call as its own
   statement (or otherwise sequenced), never as nested C++ arguments.
6. Effect claims never claim less than the ops do: neither a call's
   `EffectRef` nor the function's summary. With `VerifyEnv.effects`, a
   caller's claims must admit its callees' reads, writes and throws. A
   plan's effects are the program analysis's to know: the summary is not
   checked against it.
7. Every non-body region is owned once, by an op of its parent region.
   `break` names an enclosing target; `continue` names an enclosing loop,
   and never from that loop's own `next`. The branches of an `if` with a
   result end in `yield` of the result type, or in another terminator.
8. Module places are declared at entry (`modulePlaces`); a store to a
   constant module place is rejected.

### Effect summary

```ts
export interface EffectSummary {
  reads: "none" | "module" | "unknown";
  writes: "none" | "module" | "unknown";
  allocates: boolean | "unknown";
  throws: "no" | "yes" | "unknown";
  suspends: boolean;
  callbacks: "none" | "known" | "unknown";
  affinity: "any" | "main" | "unknown";
  native: "none" | "known" | "unknown";
}
```

- `callbacks: "known"` also covers calling parameters whose functions
  the caller binds.
- Module state is a `let`, a non-readonly static, or a `const` holding an
  object. Loads of constant module places are not state.
- Without analysis, every field is filled conservatively (`unknown`,
  `true`), except where the lowered body trivially proves otherwise (a
  body of only `const` and `binary` ops).
- v1.2 adds `blocks`, `schedules` and an `affinity` of `"worker"` to the
  contract. **The code differs:** the IR's `EffectSummary` keeps the v1
  fields. The analysis' own `Summary` carries `blocking`, `schedules`
  (starts continuations, distinct from `suspends`) and a `worker`
  affinity, and `effectSummary` projects a worker or mixed affinity to
  `"unknown"` in the IR record.

### Program facts

`programFacts(lp)` analyses a Lucent program once per `ts.Program`
(cached) and is the analysis contract for task isolation, buffer
borrows and views:

```ts
export interface ProgramFacts {
  readonly units: readonly Unit[];
  unit(node: ts.Node): Unit | undefined;
  byId(id: string): Unit | undefined;
  summary(unit: Unit): Summary;
  /** The IR's effect record for a unit. */
  effects(unit: Unit): EffectSummary;
  /** The contexts that may run a unit, each with why. */
  owners(unit: Unit): ReadonlyMap<OwnerId, Cause>;
  /** Why a unit (and all it runs) cannot run on `context`; empty when it can. */
  check(unit: Unit, context: Context): Violation[];
  /** The module state only main-thread code uses, and why the rest is not the main thread's. */
  mainState(): MainState;
  captures(unit: Unit): Capture[];
  checkCaptures(unit: Unit, context: Context): Violation[];
  /** Why a value of `type`, named `name`, cannot be handed to another context. */
  transfer(type: ts.Type, name: string): TransferProblem | undefined;
  /** How a variable's value can outlive its unit: returned, stored, captured, kept, used after `await`. */
  escapes(symbol: ts.Symbol): ValueEscape[];
  dump(): string;
}
```

- `check(unit, "task")` and `check(unit, "main")` back compute tasks
  (LUCENT3011, LUCENT3012), buffer borrows (LUCENT3030) and component
  setups (LUCENT3022).
- Richer parametric facts (invocation by parameter symbol, escapes and
  returns by index, mutation) stay internal to the analysis.
- `AnalysisInput.posts?: (call: ts.CallExpression) => boolean` (v1.2.1)
  marks calls that hand their arguments on and run none of the program's
  code while they run: a view's event prop, `expose`. The default marks
  none. The view analysis builds its own `analyze(...)` with `posts`
  rather than using the cached `programFacts(lp)`.
- `OwnerId`: units get `legacy-module`, `main`, `task` (compute entries)
  or `unknown`. A helper runs in each context of its callers, so it takes
  theirs. `IrValue.owner` stays unset.
- `AnalysisInput.mainRoots?: readonly ts.Node[]` names functions that run
  on the main thread whatever exports them: the view analysis passes
  component setups and their commands, which own `main` instead of
  `legacy-module`.
- `mainState()` (`analysis/main-state.ts`): a top-level variable is the
  main thread's when every reference to it is in a unit owned by `main`
  alone (its own initializer aside), and, unless it holds only plain
  values or native objects, it is a library `Map`, `Set` or array of
  such values, used through its members, starting and assigned as a
  literal or an empty collection. `check(unit, "main")` accepts reading
  and writing it, and names why any other module variable is not. The
  emitter assigns these variables in a job `init()` posts to the main
  thread (`ViewAnalysis.mainState`).

### First proof

A fixture with literals, arithmetic, locals and calls, including
`combine(next("l"), next("r"))` where `next` logs and the first call may
throw, compiles through the IR. Its observable output equals the
reference JavaScript's (the e2e cases).

### Revisions

- **v1** (2026-09-25, T01, frozen): IR placement and selection, the data
  model, verifier invariants 1 to 6, the effect summary's shape.
- **v1.1** (2026-09-25, T05, frozen): `PlaceId`, a branded dense number
  shared by locals and module variables; `IrFunction.modulePlaces`
  (declared at entry, stores to constants rejected);
  `verify(fn, { signature(id) })`; optional `name` on `param` ops;
  invariant 3 accepts `void`, `undefined` and `never`; invariant 6
  reworded so effect claims never claim less than the ops; selector
  modes `legacy | ir | ir-strict`. Migration: none (additive).
- **v1.2** (2026-09-25, T18 and T19, frozen):
  - T18's structured control flow: `TargetId`; `if`, `loop` and `block`
    ops; `break`, `continue` and `yield` terminators; invariants 7 and
    8; `convert` as a pure representation change; `select` dropped;
    `try` deferred. The formal v1.2 entry omitted these; the code has
    them.
  - T19's effect changes: `blocks`, `schedules`, and the `worker`
    affinity (see the code difference above); `callbacks: "known"`
    covers parameters the caller binds; the module-state definition;
    invariant 6 with `VerifyEnv.effects`; `ProgramFacts` frozen as the
    analysis contract.
  - Migration: none for generated code.
- **v1.2.1** (2026-09-26, T30 and T36, proposed): `OwnerId` drops
  `"caller"` (propagation already means "the caller's context") and
  `"task"` is produced by compute entries; `AnalysisInput.posts`.
  Migration: none.
- **v1.3** (2026-10-01, T53, proposed): the `plan` op, `LeafHost`
  (`plan`, `convert`, `place`, `platformOnly`) and the platform hooks of
  `LowerHost`; invariant 6 leaves plans to the program analysis. The
  `closure`, `unreachable` and `never` ops, `IrFunction.captures`, boxed
  locals, and `LowerHost.isBoxed`, `signatureOf` and `effectsOf`. The
  `iterate` op and `LeafHost.part` and `keys`. The `try` and `dispose`
  ops, `LeafHost.dispose`, `LowerHost.isError` and `derives`; `throw`
  takes Error subclasses. Optional chains through `LeafHost.link`. The
  `await` and `produce` ops, `IrFunction.generator`, async functions'
  results as what their promise fulfils with. Constructors' and modules'
  initializers (`Initializer`, `LowerInput.construct` and `span`,
  `lowerInit`, `LeafHost.superCall`); `Initialization` also for the
  constructor a class does not declare. `LeafHost.step` and `equals`;
  `LeafOperands.operand` takes a type hint. Components' setups: the
  `mount` type, `closure.enters` and `LowerHost.enters`, ambients
  (`LowerInput.ambient`, `LeafOperands.ambient`), thunks
  (`LeafOperands.thunk`, `Thunk`), `IrFunction.elsewhere`, and
  `LeafHost.whole` for a chain the backend plans whole (an event's
  call).
  Migration: none (additive; the default lowering is unchanged).

## C-EXEC: execution identities, scopes and operations

**Current version: v1.6 (proposed).** v1.5 is frozen.

C-EXEC is the runtime's model of who owns work and where it runs. It lives
in namespace `lucent` and uses no JSI types (except the `Host` of v1.3,
in `lucent/jsi`).

### Identities

```cpp
/// 0: no JS runtime (headless or native-only work).
using RuntimeId = uint32_t;
/// Process-unique and never reused; 0 is none.
using ScopeId = uint64_t;
/// Per scope; changes when the scope is disposed.
using Generation = uint32_t;
/// Process-unique and never reused; 0 is none.
using OperationId = uint64_t;

/// Valid only while all four fields match a live scope and the operation is
/// still pending there (Scope::validates).
struct OperationToken {
  RuntimeId runtime = 0;
  ScopeId scope = 0;
  Generation generation = 0;
  OperationId operation = 0;
};
```

A token is valid only if all four fields match the live scope's current
state and the operation is still pending. A token is never validated by
pointer or tag alone.

### Scope

States move one way: `Active → Disposing → Disposed`.

```cpp
class Scope : public std::enable_shared_from_this<Scope> {
 public:
  enum class State : uint8_t { Active, Disposing, Disposed };
  using CleanupId = uint64_t;

  /// Where a scope's disposal runs: an execution context.
  class Owner {
   public:
    virtual bool isCurrent() const = 0;
    virtual bool post(std::function<void()> job) = 0;  // false if it takes no more work
  };

  /// A child has its parent's owner and runtime: under a parent with a runtime,
  /// another `runtime` (0 included) throws std::invalid_argument. A child of an
  /// inactive parent is created disposed.
  static std::shared_ptr<Scope> create(RuntimeId runtime, const std::shared_ptr<Scope>& parent = nullptr);
  static std::shared_ptr<Scope> createRoot(RuntimeId runtime, std::weak_ptr<Owner> owner);

  ScopeId id() const;
  RuntimeId runtime() const;
  Generation generation() const;
  State state() const;

  /// Registers a cleanup. If the scope is not active, runs it now, on the
  /// calling thread (its error reaches the caller), and returns 0.
  CleanupId onDispose(std::function<void()> cleanup);

  /// Removes a cleanup that has not run; false if it ran, was removed, or
  /// disposal has begun.
  bool remove(CleanupId id);

  /// Idempotent. Changes the generation (invalidating tokens) and rejects new
  /// registrations, then disposes the children (most recently created first),
  /// cancels the pending operations (most recent first) and runs their
  /// cleanups, then runs this scope's cleanups in reverse order. Everything
  /// runs even if something throws; the errors come back aggregated like
  /// `using`: the last one, with the earlier ones as SuppressedError.
  std::exception_ptr dispose();

  bool validates(const OperationToken& token) const;

  /// Live children, pending operations and cleanups not yet run.
  size_t registrations() const;
};
```

- Children hold a weak reference to their parent; the parent holds
  strong references to its live children. Disposing the parent disposes
  the children.
- Dropping the last reference to an active scope disposes it; errors
  there go to `reportUncaught(e, "scope")`, since destructors cannot
  throw.
- All methods are safe from any thread. A scope with an owner disposes
  on its owner: `dispose()` from another thread (or the last reference
  dropped there) posts the disposal and returns `nullptr` at once; the
  scope stays active until the disposal runs, and its errors go to
  `reportUncaught`. Without an owner, or once the owner takes no more
  work, cleanups run on the disposing thread.
- A `dispose()` that finds the scope already disposing (reentrant, or on
  another thread) returns at once, without waiting.
- Recycling is disposal plus a new child scope; there is no in-place
  recycle.

### One-shot operation

```cpp
enum class OperationState : uint8_t { Pending, Succeeded, Failed, Cancelled };

template <class T>  // T may be void; errors are lucent::Error
class Operation {
 public:
  using Value = std::conditional_t<std::is_void_v<T>, Undefined, T>;
  struct Outcome { OperationState state; std::optional<Value> value; Error error; };
  using Listener = std::function<void(const Outcome&)>;
  /// Begins the native work and returns the cleanup that ends it (or an empty
  /// function). It may settle the operation before returning.
  using Registration = std::function<std::function<void()>(const std::shared_ptr<Operation>&)>;

  static std::shared_ptr<Operation> start(const std::shared_ptr<Scope>& scope);
  static std::shared_ptr<Operation> start(const std::shared_ptr<Scope>& scope, const Registration& registration,
                                          Opt<Error> abortedBy);
  OperationToken token() const;
  OperationState state() const;
  bool succeed(Value value);  // true only for the call that settles it
  bool fail(Error error);
  bool cancel(Error reason);  // abort; also called by scope disposal
  void onSettled(Listener listener);  // once; now if already settled
  void setCleanup(std::function<void()> cleanup);  // empty: removes a not-yet-run cleanup
  void onLateOutcome(std::function<void(Value&&)> release);  // releases a losing success's value
};
```

Rules, each with a test:

1. Exactly one transition leaves `Pending` (an atomic compare-and-swap).
   Later outcomes are ignored; their payload goes to the late-outcome
   release hook (or is destroyed), never delivered.
2. The cleanup runs exactly once, after settlement, whether it was
   registered before or after. Removing it after it ran is a no-op.
3. Settlement listeners run once, in the order added. A listener added
   after settlement runs at once.
4. Cancelled before registration (an already aborted signal, given as
   `abortedBy`, or an inactive scope): the operation starts `Cancelled`
   and the registration is not called.
5. A registration that throws fails the operation with that error.
6. Scope disposal cancels every pending operation the scope owns, with an
   AbortError-like reason (`scopeDisposedError()`), then runs their
   cleanups. Tokens minted before disposal no longer validate.
7. Repeated callbacks after settlement are counted (debug) and dropped.
8. Ids are never reused: a new operation in a new scope has a new id and
   that scope's generation.

### Execution contexts

- Contexts: `legacy-module` (the Lucent thread and the Lucent lock, with
  ordering unchanged), `main` (the platform UI loop; never takes the
  Lucent lock), and bounded compute workers. Each has its own queue,
  microtask queue and root scope. No microtask queue is shared between
  contexts.
- A promise continuation resumes on the context that registered it.
  Settlement from another thread posts an owned outcome to that context.
- No synchronous cross-context waits: not UI to JavaScript, UI to worker,
  nor JavaScript to UI.
- The existing `main(f)` (`runOnMain` holding the Lucent lock) stays as
  the explicit legacy compatibility path; new UI code never uses it.

The API (`execution.h`):

- `ExecutionContext` implements `Scope::Owner`: `current()`,
  `currentRef()` (a null ref is the legacy module context), `legacy()`,
  `main()`, `id()`, `root()`, `isCurrent()`, `onExecutor()`,
  `post(Job[, owner scope])` (an owned post is dropped if its owner was
  disposed or regenerated), `postDelayed`. `enqueueMicrotask` and
  `drainMicrotasks` work only on the context's own thread
  (`std::logic_error` elsewhere).
- `ContextEntry`: synchronous entry into a context on its own thread. It
  refuses the legacy context, lock holders, and entry from another
  context.
- `IsolatedContext`: `create`, `shutdown` (non-waiting).
- `Scheduler` is the legacy context; the Lucent lock stays on its call
  path.
- `native.h`: the legacy `postCallback`, `callNow` and `runOnMain`, and
  the lock-free `postTo`, `callNowIn` and `runIn`;
  `detail::runOn(context, job)`.
- A promise's owner is the context current at its creation. Its state
  changes only on the owner; settlement and registration from elsewhere
  are posted; a continuation resumes where it was registered, and is
  dropped if that context stopped.
- An `AbortSignal` is owned by the context that created it.
- `report.h` holds `reportUncaught` and `logError`.

### Native references, resources and hosts

- `NativeRef(handle, release, same, ExecutionContext* releaseOn = nullptr)`
  posts its release to `releaseOn` (in place when already there) and is
  counted until released.
- `Resource` (`resource.h`): `open → closing → closed`. It closes at the
  first of `close()`, its scope's disposal, or its last reference going;
  its release runs exactly once, on its context. `close()` is idempotent
  and never waits. Use after close throws `InvalidStateError`.
- `Host` (`lucent/jsi`): `id()` (nonzero, never reused; one live host
  per runtime), `scope()` (a child of the legacy root carrying the
  runtime's `RuntimeId`), `postToModule`, `postToJs(task, dropped) ->
bool`, `invalidate()` (rejects owed promises with an AbortError),
  `goneError()`, `InstanceState { object, host }`, `instanceOf` (refuses
  a torn-down host's objects), `ownership()` and `inFlight()`. Teardown
  from the anchor's finalizer runs no JavaScript.
- Module state stays process-level (legacy), reset on `Host::create`.

### Transport and compute

- `transport.h`: `Transport<T> { static T copy(const T&, CopyGraph&) }`
  is the customization point; the `Transportable<T>` concept rejects
  functions, promises and signals. `transport(v, graph)`,
  `transportCopy(v)`, and `transportObject(ref, graph, fields)` (exact
  dynamic type, default-constructible; a subclass behind its base type
  is a `DataCloneError`). `CopyGraph { find, remember, copied,
onCommit(commit, rollback) }`. Aliases and cycles are preserved,
  `String` is shared, and `Bytes` views share one copied buffer.
- `compute.h` (not included by `lucent.h`):
  - `TaskEntry<In, Out> { name, run(In&&, TaskContext&) }`;
    `TaskContext { cancelled(), checkCancelled() (AbortError), current(),
scope() }`.
  - `compute(entry, const In&, ComputeOptions { signal, scope, pool }) ->
Promise<Out>` snapshots its input; `submit(entry, In&&, options)`
    takes it owned.
  - `ComputePool { create({ workers, capacity }), shared(),
kDefaultCapacity = 1024, shutdown(), waitStopped(ms), stats(),
setTimingSink(fn), admit(task, signal) }`, with `TaskTiming` and
    `ComputeStats`.
  - Errors: `QuotaExceededError` (queue full), `InvalidStateError`
    (closed), `AbortError` (shutdown, cancel).
  - Workers number cores − 1 (at least one) and never take the Lucent
    lock. An outcome settles once, on the owner, as a scope-owned job.
    A losing outcome is released on the worker when cancelled before it
    returned, otherwise on the owner. Entries are synchronous.

### Callbacks

`callback.h` (included by `lucent.h`):

- `fromCallback<T>(register, Opt<AbortSignal>) -> Promise<T>` and
  `subscribe(register, onValue, Opt<AbortSignal>) -> Promise<void>`.
  `register` returns `void`, `Fn<X()>` or `Opt<Fn<X()>>`: the cleanup.
- One `Operation<T>` per composition, under the calling context's root
  scope.
- Arbitration happens on the owner: calls from other threads are posted
  in call order, the first to take effect wins, and stale reports are
  dropped.
- The cleanup runs synchronously inside the settling call, or right
  after registration returns when the operation settled during
  registration. Cleanup errors go to `reportUncaught("operation")`.
- A throwing `onValue` ends the subscription with that error.
- A promise as the reported value is refused (LUCENT1007).

### Module scope, lifecycle and presentations (v1.6, proposed)

- `std::shared_ptr<Scope> moduleScope()` and `setModuleScope(scope)`
  (`execution.h`): the scope module code's work belongs to (a compute
  task, say), which is the current JavaScript runtime's scope, installed
  by `Host::create`. Tearing that runtime down (a reload) cancels the
  work. A torn-down runtime's scope stays the module scope until another
  replaces it, so nothing more starts for it. Without a runtime, it is
  the legacy module context's root. Any thread. Compiled compute submits
  under it.
- `lifecycle.h`: a pure C++ core of app and scene lifecycle.
  - `SceneId` (`uint64_t`); `AppEvent` (`DidBecomeActive`,
    `WillResignActive`, `DidEnterBackground`, `WillEnterForeground`,
    `DidReceiveMemoryWarning`, `WillTerminate`); `SceneEvent`
    (`WillConnect`, `DidDisconnect`, `DidActivate`, `WillDeactivate`,
    `WillEnterForeground`, `DidEnterBackground`); `SceneState`
    (`Unattached`, `ForegroundActive`, `ForegroundInactive`,
    `Background`).
  - `Lifecycle::shared()`. What the platform reports, on the main thread
    only (`std::logic_error` elsewhere): `connect()` returns a new scene
    id with its scope; `report(scene, event)` and `report(appEvent)` run
    the listeners. `DidActivate` makes a scene the most recently
    activated; `DidDisconnect`, after its listeners ran, disposes the
    scene's scope and forgets it. An unknown scene is ignored.
  - What it knows, from any thread: `scenes()` (most recently activated
    first), `sceneScope(scene)` (null once disconnected).
  - `subscribe(event, listener, scope)` returns a `Resource`. The
    listener runs on the main thread from the next report on, until the
    subscription is closed or `scope` is disposed (under an ended scope,
    it is closed at once). Dropping the handle does not end it. Closing
    never waits. Listener errors are reported and the rest still run.
  - `presentingScene(scenes, stateOf)` picks the scene to present in.
- `presentation.h`: `presentIn<T>(lifecycle, scene, scope, signal,
show)` presents UI in a scene as an `Operation<T>` under the caller's
  `scope`, on the main thread only. It settles once, at the first of a
  result or error, the signal, the scope's disposal, or the scene
  disconnecting (`sceneGoneError()`, an AbortError). No scene to present
  from fails with `noSceneError()`, an InvalidStateError. Already
  aborted or under an ended scope, it starts cancelled and shows nothing.
  Once settled, the dismissal `show` returned runs on the main thread.
  The UIKit adapter (`platform/ios_ui.h`) shows and dismisses; the core
  knows nothing of UIKit.

### Revisions

- **v1** (2026-09-25, T01, frozen): identities, `Scope`, one-shot
  `Operation`; the execution-context invariants recorded but not yet
  frozen.
- **v1.1** (2026-09-25, T06, frozen): `Operation<T>::start(scope,
Registration, Opt<Error> abortedBy)`, where the registration returns
  the cleanup, an aborted signal or inactive scope starts `Cancelled`
  without calling the registration, and a throwing registration fails
  it. `onSettled(std::function<void(const Outcome&)>)` with
  `Outcome { state, optional<Value> value, Error error }`.
  `setCleanup({})` removes a not-yet-run cleanup. Recycling is disposal
  plus a new child scope. A concurrent `dispose()` returns without
  waiting. A child of an inactive parent is created disposed. Migration:
  none for generated code.
- **v1.2** (2026-09-25, T20, frozen): the execution-context invariants
  become frozen, with the `execution.h` API above, owned posts, scope
  owners, promise owners, `AbortSignal` ownership and `report.h`.
  Migration: none for generated code.
- **v1.3** (2026-09-25, T21, frozen): a child scope's `RuntimeId` equals
  its parent's unless the parent's is 0 (`std::invalid_argument`
  otherwise); `Scope::registrations()`; public
  `ExecutionContext::onExecutor()`; `detail::runOn`; `NativeRef` with
  `releaseOn`; `Resource`; the `Host` API; `Object::jsIdentity` removed.
  Module state stays process-level, a known limitation. Migration: none
  for generated code.
- **v1.4** (2026-09-25, T29, frozen): `transport.h` and `compute.h`.
  Migration: none (additive).
- **v1.5** (2026-09-25, T14, frozen): `callback.h` (`fromCallback`,
  `subscribe`). Migration: none (additive).
- **v1.6** (proposed): T34's `lifecycle.h` and `presentation.h`
  (2026-09-25) and T30's `moduleScope()` and `setModuleScope()`
  (2026-09-26). Both tasks filed these under "v1.5", which had already
  been frozen with `callback.h`; this reference numbers them v1.6.
  Migration: none (additive).

## C-BIGINT: the runtime's BigInt

**Current version: v1.1 (proposed).** v1 is frozen.

`lucent/bigint.h` implements JavaScript's `BigInt` for generated code and
for native integer conversions.

### v1 text

- `lucent::BigInt` is immutable: an inline `int64` when the value fits
  (canonical, never allocates), otherwise shared 32-bit limbs. A result
  beyond 2^30 bits (V8's limit) is a RangeError.
- Construction: `BigInt()`, an explicit integral constructor,
  `fromInt64`, `fromUint64`, `fromDouble` (RangeError unless integral),
  `parse(String | string_view)` (the rules of `BigInt(string)`,
  SyntaxError), `fromDigits(sv, radix)`, and the `LUCENT_BIGINT("…")`
  literal macro.
- Operators: `+ - * / % & | ^ << >>` and their compound forms; `pow`
  (a negative exponent is a RangeError); unary `-` and `~`;
  `unsignedShiftRight` always throws TypeError.
- Division truncates, `%` takes the dividend's sign, division by `0n` is
  a RangeError, and `>>` floors.
- Comparison: `==`, `<=>` (strong ordering), `compare(BigInt, double)`
  (partial: NaN is unordered), `strictEquals`, `isZero`, `sign`.
- `asIntN` and `asUintN` (bits by ToIndex).
- Conversion: `toString(radix 2..36)`, `toDouble` (nearest, ties to
  even), `toInt64` and `toUint64` (exact, else RangeError),
  `wrapToInt64` and `wrapToUint64`, `tryInt64` and `tryUint64`.
- `hash`, `std::hash`, `toJsString`. Map keys hash by value. `Transport`
  shares the value (it is immutable).
- JSI `Convert<BigInt>`: a `jsi::BigInt` from `int64` or `uint64` within
  64 bits, the string forms beyond.

### v1.1 text

```cpp
/// The bigint as native integer type I, exactly; RangeError naming `what`
/// ("<what>: <v> is out of range for a N-bit signed/unsigned integer").
template <std::integral I>
  requires(!std::same_as<I, bool>)
I toNativeInteger(const BigInt& value, const char* what);

namespace detail {
[[noreturn]] void throwOutOfNativeRange(const BigInt& value, const char* what, bool isSigned, size_t bits);
}
```

- Reading a native integer uses the explicit `BigInt(I)` constructor,
  which glue emits braced (`lucent::BigInt{v}`): parenthesized, as the
  last statement of a statement expression, it would parse as a
  declaration.
- `what` names the value: `<param> of <Owner>.<member>`, `Struct.field`,
  `Owner.prop`, or `<member>'s result`. Android's `android.jar` carries no
  parameter names, so Android messages say `arg0 of …`.
- Platform glue helpers that go with it:
  - iOS: `OutSlot::integer` (`Opt<BigInt>`), `outBigInt`,
    `setOut(NativeRef, BigInt)`; `NumberOut<T>` for an 8-byte integral
    `T` reads and writes bigints, and its destructor no longer throws.
  - Android: `toLongArray(env, Array<BigInt>, what)`, `fromLongArray`
    (to `Array<BigInt>`), `unboxLong` (to `jlong`).

### Revisions

- **v1** (2026-09-25, TB1, frozen): the v1 text. Migration: none (new).
- **v1.1** (2026-09-26, TB3, proposed): `toNativeInteger` and
  `detail::throwOutOfNativeRange`; the platform glue helpers, which TB3
  filed under C-EXEC. Migration: none (additive).

## C-BUFFER: native buffers

**Current version: v1.1 (proposed).**

### Invariants

These were recorded at the start and still hold.

- An ordinary `Uint8Array` keeps copy semantics both ways.
- A `NativeBuffer` is a native allocation behind a control block: its
  storage, size, destructor and required executor, read-borrow count,
  write-borrow flag, transfer generation, state (open, transferred or
  closed), and debug origin.
- The reference count keeps the storage alive; it is not permission to
  access it.
- `withRead` and `withWrite` are synchronous, scoped borrows that cannot
  escape. A transfer with an active borrow fails. After a transfer, every
  alias throws on use.
- JavaScript sees an opaque handle. No writable JavaScript `ArrayBuffer`
  ever aliases storage a worker mutates.

### Runtime API

```cpp
// buffer.h
using NativeBuffer = Ref<NativeBufferObject>;  // a Lucent handle; copies alias

struct NativeBufferStats {
  uint64_t allocated, adopted, released, transfers, copies, bytesCopied;
};

class NativeBufferObject final : public Object {
 public:
  enum class State : uint8_t { Open, Transferring, Transferred, Closed };
  using Destroy = std::function<void(uint8_t* data, size_t size)>;

  static NativeBuffer allocate(double size, String origin = {});  // zeroed; RangeError on a bad size
  static NativeBuffer adopt(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* destroyOn = nullptr,
                            String origin = {});
  static NativeBuffer fromBytes(const Bytes& bytes, String origin = {});  // one counted copy

  State state() const;
  bool isOpen() const;
  size_t size() const;          // 0 once closed or transferred (like a detached ArrayBuffer)
  uint32_t generation() const;  // transfers before reaching this handle
  const String& origin() const; // debug origin, kept across transfers
  size_t readers() const;
  bool writing() const;

  template <class F> decltype(auto) withRead(F&& f);   // f(std::span<const uint8_t>)
  template <class F> decltype(auto) withWrite(F&& f);  // f(std::span<uint8_t>)

  Bytes toBytes();             // snapshot: one counted copy, under a read borrow
  bool close();                // true once; false if closed or transferred; throws while borrowed
  NativeBuffer transfer();     // storage to a new handle (generation + 1)
  static NativeBufferStats stats();
};

template <> struct Transport<NativeBuffer>;  // moves, in two phases (begin, commit, abort)

// v1.1
template <bool Writable> class BasicByteSpan;  // get, at, set, fill, setFrom; default-constructible
using ByteSpan = BasicByteSpan<false>;
using MutableByteSpan = BasicByteSpan<true>;
template <class F> decltype(auto) withRead(const NativeBuffer& buffer, F&& f);   // f(ByteSpan)
template <class F> decltype(auto) withWrite(const NativeBuffer& buffer, F&& f);  // f(MutableByteSpan)
```

The control block is the object itself: one `atomic<uint32_t>` word
(state in 2 bits, the write flag, the reader count; 0 means open and
unborrowed), the storage pointer and an atomic size, `Destroy` with its
required executor, `generation` and `origin`. Liveness is the
`shared_ptr` reference count; access is the word.

Policies:

- **Borrows** are synchronous and scoped to one call; the span must not
  escape, which the compiler enforces (the runtime cannot see a span
  escape). Reads nest and share; a write excludes every borrow. A
  conflict throws `InvalidStateError` at once, never waits, from any
  thread. A borrow keeps the handle alive.
- **Errors**: `InvalidStateError` "NativeBuffer[ (origin)] is closed",
  "was transferred", "is borrowed", or "is being transferred";
  `RangeError` for a bad size.
- **Release** happens exactly once: at `close()`, or when the last
  reference to an open handle goes, through `detail::runOn(destroyOn)`
  (in place on that executor, posted from elsewhere, in place if it
  refuses work). `close()` runs the release in place, so its error
  reaches the caller; posted and destructor errors are reported.
  `destroyOn` must outlive the buffer.
- **Transfer** needs an open, unborrowed buffer. The old object, shared
  by every alias, becomes `Transferred` with no storage; the new handle
  is the sole owner. `close()` on a moved-from alias returns false, which
  is safe for `using`.
- **Transport to tasks**: storage moves to the successor at copy time;
  the transfer commits after the whole input is copied, and any failure
  rolls back (the sender reopens with the same storage). The same buffer
  twice in one input moves once. After commit the transfer is spent: a
  refused submission or a cancelled task destroys the task's handle,
  which releases the storage on its executor. Results containing buffers
  are moved back, not copied.
- **Copies**: only `toBytes` and `fromBytes` copy payload, and each is
  counted.

### Lucent API (`lucent:core`, v1.1)

```ts
export declare class NativeBuffer {
  private constructor();
  static allocate(size: number): NativeBuffer; // zeroed; RangeError "Invalid buffer size"
  static from(bytes: Uint8Array): NativeBuffer; // one counted copy
  static stats(): NativeBufferStats; // allocated, adopted, transfers, copies, bytesCopied
  readonly byteLength: number; // 0 once closed or transferred
  withRead<R>(read: (bytes: ByteSpan) => R): R;
  withWrite<R>(write: (bytes: MutableByteSpan) => R): R;
  toUint8Array(): Uint8Array; // one counted copy
  transfer(): NativeBuffer;
  close(): void;
  [Symbol.dispose](): void;
}

export interface ByteSpan {
  readonly length: number;
  readonly [index: number]: number;
}

export interface MutableByteSpan extends ByteSpan {
  [index: number]: number;
  fill(value: number, start?: number, end?: number): void;
  set(source: Uint8Array, offset?: number): void;
}
```

- `released` is not in the Lucent stats: JavaScript cannot count
  releases made by garbage collection.
- A borrow's callback must be a function literal or a named function
  declaration (LUCENT1007 otherwise), not async or a generator
  (LUCENT3030), and `ProgramFacts.escapes` of its span parameter must be
  empty (LUCENT3030 BorrowEscape, with the path).
- A move is `x.transfer()`, or `compute(task, x | {x} | [x])` with `x` a
  local or parameter of the same function. The first later use of `x` in
  the following statements of the same block, when the move certainly
  ran (not under a condition, loop, short circuit, optional chain,
  `try`, or closure), is LUCENT3031 UseAfterMove. The check stops at a
  reassignment; `x.close()` is not a use; nested functions are not
  examined. Everything else is left to the runtime.
- Spans never cross to JavaScript (LUCENT2006); buffers cross as handles.
- In JavaScript, a `NativeBuffer` is a host object with prototype
  `lucent:NativeBuffer`; its `withRead` and `withWrite` lend a counted
  copy under the borrow (`withWrite` copies back even if the callback
  throws). The JavaScript reference implementation has the same state
  machine, error names, messages and counters.

### Revisions

- **Invariants** (2026-09-25, T01): recorded, to be frozen by the first
  implementation.
- **v1** (2026-09-25, T31, proposed): the runtime API and policies above.
  Migration: none (new).
- **v1.1** (2026-09-26, T32, proposed): `ByteSpan`, `MutableByteSpan`
  and the free `withRead` and `withWrite`; `copyOut` and `copyIn` for
  JavaScript borrows; the `lucent:core` API; LUCENT3030 and LUCENT3031;
  `buffer.h` included by `lucent.h`. Migration: none (additive).

## C-VIEW: components and views

**Current version: v2.4 (proposed).** `VIEW_CONTRACT_VERSION` in the code
is 2: it counts layout changes of `ComponentDescription` that consumers
must follow, not every revision. Every compile generates views since
v2.5; they are still in preview. [views.md](views.md)
describes the runtime behavior in full; this section states the contract.

### Invariants

These were recorded at the start and every revision keeps them.

- A component's identity is `<package>/<module path>#<export>`; a
  basename never identifies a component.
- Props arrive as immutable whole-commit transactions, in which missing,
  `null` and unchanged values are distinct.
- JavaScript callbacks are event slots and routes, never JSI functions in
  Fabric props.
- Void commands are enqueued to the UI owner; commands with a result
  return promises through request ids on the host channel.
- The mount generation is established at the committed UI mount, and
  every event, command result and measurement result validates the full
  token.
- Setup runs once per mount, never during speculative render.
- No view work runs under the legacy Lucent lock.

### Components

- A component is an exported function of a `.lucent.tsx` module (a
  function declaration, or `export const X = () => …`) whose return
  expressions, in the target's code, are objects of a class deriving
  from the target's root view class: UIKit `UIView` on iOS,
  `android.view.View` on Android, or a toolkit's root (see Toolkit
  bodies). Other platforms' branches are pruned; the host keeps every
  branch and accepts any platform's view; a declaration without a body
  uses its signature. `.lucent.ts` modules never have components.
- A component is described, never emitted as a module function, a
  JavaScript proxy export or a JSI value.
- Diagnostics: LUCENT3020 ComponentExport (shape, package, use as a
  value, several names in one `export const`, overloads, async or
  promised views, generics, more than one parameter, non-object props);
  LUCENT3021 ComponentContract (contract types, names, `expose`);
  LUCENT3022 ComponentMainThread; LUCENT3023 ComponentPlatforms;
  LUCENT3024 for toolkit bodies.

### Identity and registration

- Identity: `<package>/<module path>#<export>`. For a Lucent package, the
  package name and the module's path under its `lucent.sources`; for an
  app, the nearest `package.json` `name` and the path relative to its
  directory. Platform suffix and extension are stripped, so split files
  share their declaration's identity. No named package is LUCENT3020.
- `registration = Lucent<export, with characters outside [A-Za-z0-9_] as _>_<first 12 hex digits of sha256(id)>`.
- Host artifacts: iOS `<registration>ComponentView`; Android
  `dev.lucent.generated.<registration>Manager`.
- `source` is for messages only, never part of identity.

### Component description

```ts
/** Plain data a view receives as a prop, an event sends, or a command takes and answers. */
export type ViewType =
  | { readonly k: "number" }
  | { readonly k: "boolean" }
  | { readonly k: "string" }
  | { readonly k: "enum"; readonly values: readonly string[] } // string literals, sorted
  | { readonly k: "array"; readonly element: ViewType }
  | { readonly k: "object"; readonly fields: readonly ViewField[] }
  | { readonly k: "nullable"; readonly inner: ViewType }; // the value, or null

/** `optional`: it may be missing; a missing value, null and an unchanged value are distinct. */
export interface ViewField {
  readonly name: string;
  readonly type: ViewType;
  readonly optional: boolean;
}

export type EventDelivery = "discrete" | "continuous" | "coalesced";

export interface EventDescription {
  readonly name: string;
  readonly slot: number;
  readonly optional: boolean;
  readonly params: readonly ViewField[];
  readonly delivery: EventDelivery;
}

export type CommandResult =
  { readonly kind: "enqueue" } | { readonly kind: "request"; readonly value?: ViewType };

export interface CommandDescription {
  readonly name: string;
  readonly params: readonly ViewField[];
  readonly result: CommandResult;
}

export interface PlatformBinding {
  /** The platform class the component returns: its SDK module and name. */
  readonly root: { readonly module: string; readonly name: string };
  /** `<registration>ComponentView` on iOS, `dev.lucent.generated.<registration>Manager` on Android. */
  readonly artifact: string;
}

export interface ComponentDescription {
  readonly id: string;
  readonly package: string;
  readonly module: string;
  readonly export: string;
  /** The Lucent module whose JavaScript exports the component. */
  readonly jsModule: string;
  readonly registration: string;
  readonly props: readonly ViewField[];
  readonly events: readonly EventDescription[];
  readonly commands: readonly CommandDescription[];
  /** Whether it takes React children; none: it takes none. */
  readonly children?: { readonly optional: boolean };
  readonly platforms: Partial<Record<Platform, PlatformBinding>>;
  /** For messages; never part of its identity. */
  readonly source: { readonly file: string; readonly line: number; readonly column: number };
}

export const VIEW_CONTRACT_VERSION = 2;
```

### Props

- The props parameter's properties, in declaration order. Plain data
  only: number (numeric literal unions widen to number), boolean,
  string, enum (string literal unions, sorted), array, object (plain or
  mapped object types; fields in order), nullable.
- `optional` is `?` or `undefined` in the type. `undefined` where a value
  must exist (an array element, a command result) is refused.
- Refused, with the path to the offending part: bigint (Fabric props
  cannot carry it), `Date`, `Map`, `Set`, `Uint8Array` and other library
  objects, class instances, tuples, mixed unions, index signatures,
  recursive types, nested functions, and anything `transfer` refuses
  (native objects, promises, unknown or generic types).
- Reserved names: `key`, `ref`, `children` (except as `Children`, v2),
  `style`. Own props never share a key with host props.
- Destructured props are refused: setup runs once, and a destructured
  prop would keep its first value.

### Events

- An event is a callback prop named `on[A-Z]…`, returning nothing, whose
  parameters are plain data. Its slot is its index among the events, in
  prop order.
- JavaScript keeps the function; the view holds the slot. A direct call
  of the prop in setup code (`props.onX(...)`, `props.onX?.(...)`) posts
  its arguments: operands are evaluated and arguments copied, with no
  other effect. An alias of the prop (`const f = props.onX`) is unknown
  code.
- Payload `{ args: [...] }`, by position. An omitted optional argument is
  `undefined`; trailing omitted arguments are not sent.
- Delivery (v1.3), from `lucent:ui`'s type marks, part of the contract
  JSON (merge, declaration agreement, API hash):

  | Delivery               | Prop type                    | React Native                        |
  | ---------------------- | ---------------------------- | ----------------------------------- |
  | discrete (the default) | `(v: T) => void`             | `RawEvent::Category::Discrete`      |
  | continuous             | `Continuous<(v: T) => void>` | `RawEvent::Category::Continuous`    |
  | coalesced              | `Coalesced<(v: T) => void>`  | `EventEmitter::dispatchUniqueEvent` |

  Both marks on one event are refused (LUCENT3021). React declarations
  keep plain function types.

- Ordering: a view's events arrive in the order it sent them. A coalesced
  event replaces the view's latest waiting event of the same type, in
  place, so across views a later value may take an earlier position.
  There is no ordering between a view's events and its requests'
  answers (separate channels).

### Commands

- Commands come from one `expose({...})` call at the top level of setup,
  given an object literal whose members are functions. `expose` in a
  nested function, inside a statement, twice, with a non-literal, or
  outside a component is LUCENT3021.
- A `void` or `undefined` result is `enqueue`: it runs on the UI owner and
  answers nothing. A `T` or `Promise<T>` result is `request`: a promise
  answered through the host's completion channel by request id (`value`
  absent for void).
- The React Native command name is the command's name. Request arguments
  are `[id, …]`.

### Main thread and platform agreement

- Setup, every function created within it, and the functions its
  commands name must pass `check(unit, "main")`. One diagnostic is
  reported per rule and final cause.
- One description per id across targets. Props, events and commands are
  equal on every platform target, a component on one compiled platform
  must be one on all, and a split module's implementation describes the
  same props and events as its shared declaration (LUCENT3023). Host
  descriptions count only when no platform target was compiled. Targets
  with errors are not compared.

### Generated code and transport

- Files: `cpp/generated/<target>/views/<registration>.{h,cpp}` and
  `views/lucent_views.{h,cpp}`; namespace
  `lucent::views::<registration>`; the Fabric `ComponentName` is the
  registration. Each component's descriptor header declares its `Props`,
  `EventEmitter`, `ShadowNode` and `ComponentDescriptor`.
- Keys: props `p<index>`, events `e<slot>`, React Native event names
  `lucent<slot>` (`topLucent<slot>` mapped to `e<slot>`).
- C++ values: optional presence and nullness are kept; vectors; numbered
  `ObjectN_` and `EnumN_` types; field names made C++ identifiers and
  numbered `_2`, … on a clash. `changed()` treats `Object.is` or deep
  equality as unchanged. `handlers` holds the event-slot enable bits.
- The completion channel is the Lucent host object's
  `__lucentViewRequests(settle)`, called on the JavaScript thread with
  `settle(id, error | null, value)`. JavaScript rejects on unmount and
  ignores late answers.
- The React surface: own props, callbacks, `style`, and a `ref` to the
  commands; no other ViewProps. React declarations are written to
  `types/views/<module>.d.ts`, and the app imports them as
  `lucent:views/<module>`: TypeScript through its `lucent:*` path, Metro
  through `withLucent`'s resolver, to `js/_lucent/components/<module>.js`,
  which requires the component's module (`CompileResult.componentModules`
  names its file).
- The module API hash covers component contracts, so a contract change
  makes the loader refuse a stale build rather than warn.

### Mount and hosts

The generated mount, in `views/<registration>.h` (defined in
`views/<registration>_mount.cpp`):

```cpp
using Event = std::variant<Event0, …>;            // std::variant<std::monostate> without events
using Emit = std::function<void(const Event&)>;

struct Mount {
  /// Main thread, committed mount; runs setup once. `slot` only for a component taking children.
  static std::shared_ptr<Mount> create(const Props& props, Emit emit /*, lucent::NativeRef slot */);
  lucent::NativeRef view() const;                          // what setup returned; empty if setup threw
  void update(const Props& props, const Props& previous);  // any thread; at once on the main thread
  void setEmit(Emit emit);                                  // main thread
  void command(const Command& c, lucent::views::Respond respond);  // main thread; with commands only
  void dispose();                                           // main thread; idempotent
};
```

- `lucent::views::Answer { double request; std::optional<std::string>
error; std::function<jsi::Value(jsi::Runtime&)> value; }` and
  `Respond = std::function<void(Answer)>`; `value` is set only when
  `error` is empty.
- Setup is `<X>_setup`, with `<X>_Props` and `<X>_Commands`, in the
  module's namespace. Setup code uses `lucent:ui`: `signal`, `effect`,
  `expose`, `onDispose`, `bind`, `slot`, `invalidateSize`, `Children`,
  `Continuous`, `Coalesced`. Setup makes the native objects it shows
  directly (`new UILabel()`); they go with the mount. Lucent classes
  given to the platform from a setup are refused.
- Host steps: create at the committed mount, with a `MountToken { tag,
generation }` whose generation is process-unique and never 0; update
  per commit, never re-running setup; commands parsed by the host
  (`parseCommand`; a request whose arguments do not parse, or that
  reaches a view without a mount, is rejected at once); dispose at
  unmount or recycle. Every entry enters the main context itself
  (`ContextEntry`).
- `Mount::dispose` closes the prop inbox, disposes the mount's scope
  (effects stop, `onDispose` cleanups run), clears its event routes,
  releases the event route and the view, and rejects the requests it
  still owes. Nothing of the mount reaches the host afterwards.
- iOS: `LucentComponentView` (a subclass of `RCTViewComponentView`) and a
  generated `<registration>ComponentView.mm` adapting `Mount` to
  `Mounted`, which exposes `view()`, `controller()` (a hosting
  controller to contain, or nil), `update` and `command`.
- Android: per-component managers `dev.lucent.generated.<registration>Manager`
  (each a `LucentViewManager`, listed by the generated
  `LucentViewManagers`), `LucentHostView` shells, descriptors listed for
  autolinking (`componentDescriptors` and `ComponentDescriptors.h`),
  wrapped in `HostDescriptor`. `views/<registration>_android.cpp` adapts
  the mount and `views/lucent_hosts.cpp` lists components
  (`findComponent`). Create happens at attach, or at the first command
  if it comes first. Event emitters are found by `(surfaceId, tag)`,
  never by tag alone.

### Requests and errors

- A mount answers each request exactly once: a result, an error, or at
  dispose "`<Export>` unmounted before answering". A promise's answer is
  owed in the mount's table; its continuation holds the mount weakly.
  Work is not cancelled (promise semantics); setups stop theirs with
  `onDispose`.
- Hosts answer through `lucent::views::answerTo(host, requester)`
  (`LucentViewRequests.h`), which drops an answer unless the view still
  holds the mount's full `MountToken`.
- An answer for a torn-down runtime is dropped and what it carries is
  released on the module context.
- JavaScript ref errors: `InvalidStateError` for a command while not
  mounted (before attach or after unmount), `AbortError` for a request
  pending at unmount, `Error` with the native message otherwise.

### Sizing

- A component whose style gives it a size fills it: the view setup
  returns is laid out in the host's content box (its frame less border
  and padding).
- A component without children and without a fixed size is a measurable
  Yoga leaf, sized by its content through its Fabric state. Its shadow
  node records the bounds Yoga asks for, completed with the font scale
  and layout direction; the host measures on the main thread and posts
  `{ size, constraints, revision }`; the renderer keeps a measurement
  only if it answers the constraints asked for now, its revision is not
  older, and the size changes by more than one physical pixel. Sizes are
  snapped up to the pixel grid.
- A measurement answers the constraints it was made under, and stricter
  bounds its size still fits; never a looser bound, another font scale
  or another direction.
- The content revision is 1 at mount and goes up each time the mount's
  code has run (the host and every function setup made enter the mount's
  `Content`). Code after an `await` calls `invalidateSize()`.
- A host posts at most three measurements that do not settle its state
  before its content changes again.
- The new size waits for the JavaScript thread, which applies state
  updates; the native side never waits.

### Children and slots

- A component takes React children when its props declare
  `children?: Children` (or `children: Children`). Its setup then calls
  `slot<T>()` once, in a `const` at its top level, with `T` the
  platform's container class (UIKit `UIView`, Android `ViewGroup`), and
  places that view in its tree. Children without a slot, a slot without
  children, a second slot, a slot made elsewhere, or reading
  `props.children` are refused. React's declarations take
  `children?: ReactNode`.
- Ownership: React Native owns each child and its frame; the host owns
  the slot (a new one per mount) and the children's order in it; setup
  owns the slot's placement (ancestors, z-order, frame). The slot never
  lays its children out.
- A component taking children is a Yoga container (`SlotShadowNode`),
  sized like a View and never measured by content.
- Children's frames stay in the component's coordinates, so `onLayout`
  and `measure` are unchanged; the slot shows them there wherever it is,
  clipped to its bounds.
- Slot placement (v2.1): the host reports the slot's insets within the
  content box Yoga laid the component out with, as
  `slot: Placement { revision, insets, rtl, swapped }` in the component's
  state, snapped to physical pixels. The shadow node adds the insets to
  its Yoga border (start and end from the reported direction), so
  children lay out in the slot's rectangle, and restores the real border
  in the metrics the host sees. Before the first report, children lay
  out in the content box. At most three unsettled reports are posted. An
  absolutely positioned child is placed from the slot as a View's child
  is from its padding box.

### Toolkit bodies

A component may draw its view with SwiftUI (`lucent:swiftui`) on iOS or
Jetpack Compose (`lucent:compose`) on Android instead of platform views.

- **Roots.** A body is the toolkit's JSX element type (`View` for
  SwiftUI, `Composed` for Compose). The component's root view is the
  toolkit's: `UIHostingController` on iOS, `ComposeView` on Android.
- **Body.** Setup returns its body as JSX, once, as the last statement
  of its platform's code. There is no wrapper call: the body is the
  returned JSX, found by its type. The rest of setup is ordinary Lucent
  code (signals, effects, commands, timers, events), compiled to C++ on
  the main context.
- **Typing.** A platform file's JSX (`*.ios.lucent.tsx`,
  `*.android.lucent.tsx`) is its toolkit's. A shared `.lucent.tsx` file's
  JSX runtime is `lucent:jsx`, whose element is every typed toolkit's at
  once (`View & Composed`). A toolkit whose SDK is missing is left out and
  its code is untyped.
- **One file.** A component may be one shared `.lucent.tsx` file, its
  logic once and each platform's body in that platform's code (a
  `PLATFORM` branch, the code after a guard that returns, or a top-level
  declaration using one platform's code). A toolkit name outside its
  platform's code is LUCENT3024. A body on one platform only is
  LUCENT3023. Split platform files stay supported.
- **SwiftUI JSX.** An element is an initializer. An attribute named like
  a label of the chosen form is an argument (the initializer's label
  wins over a modifier of the same name); every other attribute is a
  modifier, applied in source order; repeated modifiers chain after the
  element (`(<Text>a</Text>).padding(4)`). Views in content must be JSX;
  calls stay for values.
- **Compose JSX.** An element is a UI composable or a scope's content
  member (`LazyListScope.items`); props are named parameters and
  children are the content lambda. Composition statements (statements of
  the Android code that call a composable, such as `animateFloatAsState`)
  are lifted into the composition, in order; a composable inside a
  branch, a loop or a setup function, setup code reading what a
  composition statement declares, or another Compose use in setup code is
  LUCENT3024.
- **Slots between setup and body.** Plain data the body reads from setup
  is a value slot, computed by setup's C++ with JavaScript semantics and
  re-set by an effect on the main thread. A setup function the body calls
  from a callback is an action slot, which runs in the main context. An
  array shown item by item is a keyed list slot. `bind(signal)` gives a
  number, boolean or string signal to a view that changes it.
- **Helper views.** Non-exported functions of the same platform code
  returning toolkit JSX become a Swift `View` struct or a Kotlin
  `@Composable` function, never C++. They take one plain-data props
  object, and are refused (LUCENT3024) when they destructure props, take
  a toolkit value, show a list or bind a signal.
- **Threads and lifetime.** All toolkit work runs on the main thread,
  with no Lucent lock and no thread waits. A SwiftUI component's hosting
  controller is contained in the nearest parent view controller while in
  a window. A Compose body's composition is disposed at mount end. A slot
  under a toolkit body sits in a `UIViewRepresentable` or `AndroidView`;
  the toolkit owns only the slot's frame, never the children's layout.

### Platform-view JSX

A component may return its platform's views as JSX (T48): a UIKit or
Android view class is a tag. [views.md](views.md#platform-views-as-jsx)
has the details.

- **Rules.** What a tag takes is derived from its class's declarations
  and its superclasses', the nearest winning, with no view, prop or event
  listed in Lucent: writable properties and (Android) one-value setters;
  Android `setOn<X>Listener` of a one-method listener as `on<X>`; iOS
  control events (`addAction:forControlEvents:`) as `on<Case>`, the
  handler given the tag's class; children where the class declares an
  insert-at-index method; construction by a zero frame, `init` or the
  hosting view's Context, else the element's `create`.
- **Typing.** A view class's declaration gives its attributes under
  `"~jsx:<module>.<class>"`; the root view's `"~jsx"` gathers them
  (`NativeAttributes<this>`), each documented with its rule and artifact.
  A JSX element is the toolkit's view and the platform's root view at
  once; a component returning native JSX declares the root view, and its
  root is the returned tag's class. Present only under the switch.
- **Lowering.** Views are made at mount, parent first; each prop is an
  effect of the mount; events are registered once and removed at mount
  end; children are inserted in order. LUCENT3025 reports what cannot be
  made; LUCENT3022 holds in attributes.

### Revisions

- **Invariants** (2026-09-25, T01): recorded, to be frozen by the first
  implementation.
- **v1** (2026-09-26, T36, proposed): component classification,
  identity and registration, `ComponentDescription`, props, events,
  commands from `expose`, the main-thread requirement, cross-platform
  agreement, LUCENT3020 to LUCENT3023. Migration: none (new).
- **v1.1** (2026-09-26, T37, proposed): generated file layout and naming,
  transport keys and payloads, C++ value representation, the command
  channel, the React surface, and the internal `LUCENT_VIEWS=fabric`
  switch. Resolves v1's open question on React Native ViewProps name
  collisions. Migration: none (additive).
- **v1.2** (2026-09-26, TA20 with T38, T39, T42 and T43, proposed):
  reactive setup through `lucent:ui`; the generated `Mount`; the host
  contract on both platforms; the API hash covering contracts;
  `types/views/<module>.d.ts`. T38's interim seam (`LucentViewSetup.h`
  and hidden setup module functions) and T39's earlier Android seams were
  removed in favor of this one design. Migration: none for apps (views
  are internal).
- **v1.3** (2026-09-27, T45, proposed): `EventDescription.delivery`
  (`VIEW_CONTRACT_VERSION` unchanged: older consumers deliver everything
  discretely); requests answered exactly once per mount; `answerTo`; the
  JavaScript ref errors; Android emitters by `(surfaceId, tag)`.
  Migration: none (additive).
- **v1.4** (2026-09-26 and 2026-09-27, T44 and T46, proposed): sizing as
  above. Not numbered by its tasks; numbered here. Migration: none.
- **v2** (2026-09-27, T47, proposed): `children?: { optional }`,
  `Children` and `slot<T>()`, `SlotShadowNode`, `Mount::create` gaining
  the slot, `VIEW_CONTRACT_VERSION = 2`. Migration: consumers of the
  description read `children`.
- **v2.1** (2026-09-27, T47b, proposed): slot insets in the component's
  state and the border mechanism above. Not numbered by its task;
  numbered here. Migration: none (additive state).
- **v2.2** (2026-09-27 to 2026-09-30, proposed): toolkit bodies.
  - TD1 and TD2 (spikes) proposed toolkit addenda written in a call form
    (`swiftUI(() => …)`, `compose(() => {…})`); TDU made the call form
    the implementation with LUCENT3024; TD3 to TD7 generated
    `lucent:swiftui` and `lucent:compose` from the SDKs.
  - The call forms are superseded by JSX without wrappers (TJ-S for
    SwiftUI, TJ-C for Compose), and the `native()` wrapper of `lucent:ui`
    was removed in favor of direct construction (TJ-N). TJ-H added
    helper views; TJ-1 added one-file components with `PLATFORM`
    branches.
  - Migration: write bodies as returned JSX; replace `native(() => x)`
    with `x`. A leftover `native(` fails to type-check.
- **v2.3** (2026-10-04, T48, proposed): platform-view JSX as above,
  LUCENT3025, and `lucent sdk coverage --views`. A JSX element's type
  became the toolkit's view and the root view at once; components are
  classified by the returned element's tag. The design's child adapters
  (16.5) were replaced by children derived from an insert-at-index
  method. Migration: none (views are internal).
- **v2.4** (2026-10-06, proposed): `lucent:views/<module>`, the React
  types of a component module, resolved by TypeScript and Metro alike;
  `componentModules` and `js/_lucent/components/<module>.js`. Native JSX
  may be returned from any of setup's own code (a PLATFORM branch, a
  guard, a conditional's arms), and a slot made at the top level of a
  PLATFORM branch. Migration: replace a cast of `./x.lucent` with an
  import of `lucent:views/x` (views are internal).
- **v2.5** (2026-10-07, proposed): the `LUCENT_VIEWS=fabric` switch is
  gone: every compile resolves `lucent:ui`, the toolkits and JSX, and
  generates components' Fabric sources; a deferred Android build is
  configured for Compose only when the program has components; `lucent
new view` is public. Migration: drop `LUCENT_VIEWS=fabric` from builds
  and scripts; a package with components now builds in any app.

## C-BUILD: build records and identities

**Current version: v1.5 (proposed).** v1 is frozen.

C-BUILD is what a build records about itself and what it requires of the
app afterwards. `build`, `check`, `dev`, Metro and the native build hooks
all go through one pipeline (`buildProject`); there are no recursive
builds.

### Build record

`.lucent/build-record.json`, written atomically on every return of
`buildProject`:

```ts
export const BUILD_RECORD_SCHEMA_VERSION = 1;

export type NodeKind =
  "resolve" | "extract" | "check" | "generate" | "native-build" | "install" | "reload";

export type NodeStatus = "ok" | "cached" | "failed" | "skipped";

/** A project-relative path or a named key, and its content hash. */
export interface Artifact {
  key: string;
  hash: string;
}

export interface BuildNode {
  /** Unique within a record: `check`, `extract:ios/UIKit`. */
  id: string;
  kind: NodeKind;
  status: NodeStatus;
  inputs: Artifact[]; // sorted by key
  outputs: Artifact[]; // sorted by key
  /** sha256 of the kind, inputs and outputs, first 16 hex digits. */
  hash: string;
  detail?: string;
  /** Where the step's full output was written, relative to the project. */
  log?: string;
}

export type RequiredAction =
  | { kind: "none" }
  | { kind: "reload-js" }
  | { kind: "compile-native"; targets: string[]; changedUnits: string[] }
  | { kind: "relink"; targets: string[]; dependencyChanges: string[] };

/** Strongest first. */
export const ACTION_KINDS = [
  "reinstall",
  "relink",
  "compile-native",
  "repackage",
  "reload-js",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface PendingAction {
  kind: ActionKind;
  targets: string[];
  /** Native-package paths. */
  files: string[];
}

export interface BuildRecord {
  schemaVersion: 1;
  mode: "build" | "check";
  nodes: BuildNode[];
  requiredAction: RequiredAction;
  pendingActions: PendingAction[];
  /** Milliseconds per node id; excluded from node hashes. */
  timings: Record<string, number>;
  /** When each timed node started, in milliseconds from the build's start. */
  startedAt: Record<string, number>;
}
```

- Deterministic: two builds of the same inputs write the same nodes.
  Timings and start times live apart from the nodes and are never
  hashed. Paths are project-relative.
- `requiredAction` comes from the pipeline's summary of changes: native
  files added or removed is `relink`; rebuilt native code is
  `compile-native` with the written C++ units; changed proxies only is
  `reload-js`; otherwise `none`.
- `pendingActions` lists every action the build's changes need, by kind,
  strongest first: `reinstall` (app configuration changed),
  `relink` (native dependencies or build files), `compile-native`,
  `repackage` (resources or assets), `reload-js`. `build --json` reports
  them as `actions`.
- The `native-build`, `install` and `reload` node kinds are reserved; the
  pipeline does not record them yet.
- `manifest.json` is not a `generate` output (its cache key embeds
  absolute paths, and it lists the files the check read by theirs);
  `resolved.json` is.
- The `check` node's inputs are the sources, `targets`, and every other
  file the check read in the project, project-relative, hashed by the
  content read; a path it looked for and did not find is `missing`, or
  `directory` when one is there. The files it read outside the project
  are one `outside-project` input, hashed on their contents alone (the
  paths it found nothing at there left out).
- The `resolve` node lists one `packages/<package>/<path>` input per
  native path a package's `lucent.json` lists. Native extensions are
  read in an `extract:extensions` node.

### Build outcome

`BuildOptions` gains `signal` (aborted when a newer change makes the
build stale; it stops before publishing anything) and `frozen`.
`BuildOutcome` gains `actions`, `superseded`, `nativeInputs` (every
Lucent package file the build read), `read` (every path its check read:
the files, and the paths it resolved links from), `usage` (what the checked code uses
of the SDKs) and `skipped` (the targets the project has code for that
this build left out, and why).

### SDK lock and usage

- `.lucent/sdk-usage.json` and `lucent-sdk.lock.json` share one format,
  the `SdkUsage` of C-BIND v1.4, with `format: 1`: `targets` (sorted),
  `modules` (`"<platform>/<module>"` to `{ artifacts: ["<id>#<contentHash>"]
sorted, schema?: "<scope>/<entry>" }`), and `symbols` (sorted by
  `symbolKey`). JSON schemas: `packages/lucent/schemas/sdk-lock.schema.json`
  and `sdk-diff.schema.json`.
- `lucent sdk lock` records the lock. `--frozen` on `build` and `check`
  fails unless the SDKs and SDK symbols are the ones the lock records,
  with every target it lists, and takes nothing from earlier builds'
  caches. `lucent sdk diff` compares used symbols across SDK versions.
- A check or build reruns when `sdk-usage.json` is missing or
  unreadable.

### Build identity

What a compile built, by target (`ios`, `android`, `host`, or `all` for
a program every target shares):

```ts
export interface BuildIdentity {
  runtimeAbi: number;
  /** Target → hash of the target's generated files. */
  programs: Record<string, string>;
  /** Target → module → hash of what JavaScript sees of the module. */
  apis: Record<string, Record<string, string>>;
}
```

- `programHash`: sha256 (first 16 hex digits) of the target's generated
  files (C++, Swift, Java, Kotlin), with `#line` directives and trace
  sites' files and lines removed, so machine paths and line shifts do not
  count.
- The API hash per module is a canonical description of the boundary:
  exports, signatures, struct fields, class members, enum values,
  component contracts; interface ids are made portable.
- `runtimeAbi` is the compiler's `RUNTIME_ABI` (2), equal to the
  runtime's `kRuntimeAbi` in `lucent/jsi/host.h`; the generated identity
  unit (`lucent_identity.cpp`) static-asserts the equality.
- Native code exposes the identity as `__lucentIdentity` on the host;
  JavaScript gets the expected identity from `js/_lucent/identity.js` in
  the native package, which proxies pass to `loadModule`. The identity
  is also in the native package's `manifest.json`.
- The loader checks each module before loading it, once per host and
  expected program:
  - no identity, a different runtime ABI, a target program missing from
    the expected identity, a module missing, or a module API that
    differs: throws an `Error` with `code: "LUCENT_NATIVE_MISMATCH"` and
    `action`, a pending-action kind (`compile-native`, or `reload-js`
    when the native runtime ABI is newer);
  - a program-only difference: one warning, and the module loads.
- `identity.js` is ignored by pending-action classification: it moves
  with the generated native code, whose change already names the action.
- **The code differs** from the frozen v1 text: `BuildRecord` has no
  `identity` field. The identity lives in the native package's
  `manifest.json` and `js/_lucent/identity.js`.

### Revisions

- **v1** (2026-09-25, T09, frozen): the build record, `RequiredAction`,
  node kinds and statuses. As implemented, it differs from the first
  sketch: `mode` was added; timings moved to a separate map instead of
  `startedAt` and `durationMs` per node; the `native-build`, `install`
  and `reload` kinds are reserved. The first sketch's `BuildIdentity
{ runtimeAbi, publicApiHash, nativeProgramHash }` is superseded by
  v1.4. Migration: none (new file).
- **v1.1** (2026-09-25, T22, proposed): `resolve` inputs for package
  native paths; `resolved.json` as a `generate` output. Migration: none
  (additive).
- **v1.2** (2026-09-25, T23, proposed): `pendingActions` and
  `PendingAction`; `build --json` `actions`; `BuildOptions.signal`,
  `BuildOutcome.superseded` and `nativeInputs`. Migration: none
  (additive).
- **v1.3** (2026-09-26, T24 and T40, proposed): the SDK lock and usage
  format, `--frozen`, `BuildOutcome.usage` and `skipped` (T24);
  `BuildRecord.startedAt`, outside node hashes like `timings` (T40).
  Migration: none (additive).
- **v1.4** (2026-09-25, T41, proposed): `BuildIdentity` per target and
  per module, the identity unit, and `LUCENT_NATIVE_MISMATCH`. T41 came
  before T24 and T40; its revision is numbered after theirs here.
  Migration: apps built before build identities fail to load with
  `compile-native`: rebuild the app.
- **v1.5** (2026-10-04, proposed): the `check` node's inputs include
  every other file the check read, those outside the project as one
  `outside-project` input; `.lucent/check.json` and the native
  package's `manifest.json` list them (`read`), and the paths
  resolution followed links from (`realpaths`, keyed on where each led;
  not in the record, whose nodes name no machine path). Migration: none
  (the first check or build after it runs again).

## C-TRACE: correlated tracing

**Current version: v1 (proposed).**

`lucent/trace.h`, namespace `lucent::trace`:

```cpp
enum class Category : uint8_t { Entry, Lock, Queue, Run, Native, Completion, Compute, Copy, Alloc, Build };

struct Site { const char* name; const char* file; int line; };  // static

struct Event {
  enum class Phase : char { Span = 'X', Instant = 'i', Counter = 'C' };
  Phase phase; Category category; const char* name; const char* detail;
  uint64_t startNs, durationNs, id, parent; int64_t value, count;
  uint32_t thread, context; const Site* site;
};

struct Options { size_t capacity = 65536; bool platform = false; };

bool enabled() noexcept;  // one relaxed load
void start(Options options = {});
void stop();
void startFromEnvironment();
std::vector<Event> events();
uint64_t dropped();
std::string chromeJson(const std::vector<Event>& events);
bool writeChromeJson(const std::string& path);
uint64_t now() noexcept;
uint64_t toNs(std::chrono::steady_clock::time_point at) noexcept;
uint64_t newId() noexcept;

struct Detail { /* id, parent, value, count, site, detail */ };
struct Mark { /* startNs, cookie */ };
Mark begin(Category category, const char* name) noexcept;
void end(const Mark& mark, Category category, const char* name, const Detail& detail = {}) noexcept;
void span(Category category, const char* name, uint64_t startNs, uint64_t endNs, const Detail& detail = {}) noexcept;
void instant(Category category, const char* name, uint64_t id = 0, int64_t value = 0) noexcept;
void instant(Category category, const char* name, const Detail& detail) noexcept;
void counter(const char* name, int64_t value) noexcept;
uint64_t currentId() noexcept;
class Current;
class Correlate;
uint64_t takeCorrelation() noexcept;
class Scope;  // RAII native span

#define LUCENT_TRACE_SITE(name)
#define LUCENT_TRACE_SITE_AT(name, file, line)
#define LUCENT_TRACE_SCOPE(name)

// jsi/convert.h
callSync(rt, host, const trace::Site*, body);
callAsync<T>(rt, host, const trace::Site*, start);
settleLater(host, id, promise, traceId = 0, site = nullptr);
```

Event vocabulary:

| Category   | Names                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entry      | `<export>`, with its `.lucent.ts` site                                                                                                                                       |
| lock       | `lucent-lock`                                                                                                                                                                |
| queue      | `wait`, `js.wait`                                                                                                                                                            |
| run        | `run`                                                                                                                                                                        |
| native     | the `LUCENT_TRACE_SCOPE` name, with its site                                                                                                                                 |
| completion | `<export>`                                                                                                                                                                   |
| compute    | `compute.wait`, `compute.run`, `compute.deliver` (detail: the entry's name); instants `compute.saturated` (value: queue depth), `compute.rejected`; counter `compute.queued` |
| copy       | `transport.copy` (value: bytes, count: objects), `buffer.copy`                                                                                                               |
| alloc      | `buffer.allocate`, `buffer.adopt` (bytes)                                                                                                                                    |
| build      | `<node id>`, from the build record (CLI)                                                                                                                                     |

- Correlation: an async call's id covers its entry, the queue and run of
  its job, `js.wait`, and its completion. Posts made inside a traced job
  name it as `parent`. Each compute task has its own id.
- Environment: `LUCENT_TRACE=1 | platform | <file>.json` (host and iOS);
  the `debug.lucent.trace` system property on Android, where ATrace is
  always mirrored.
- Platform mirror: os_signpost subsystem `dev.lucent`, category
  `runtime`, interval names by category; Android ATrace async sections
  `category:name` (API 29 through `dlsym`), counters through
  `ATrace_setCounter`.
- Policies: off costs one relaxed load per hook. On, events go to a ring
  buffer (one mutex) keeping the latest `capacity`, and drops are counted
  (exported as `otherData.dropped`). The platform mirror is opt-in; on
  Android, ATrace checks `ATrace_isEnabled` first.
- Sites: bindings name the export's declaration (the same path as
  `#line`); native spans inside Lucent code take `__FILE__` and
  `__LINE__` under the compiler's `#line`. Build identities ignore trace
  site positions.
- `lucent trace` lays out build phases from `.lucent/build-record.json`
  (`startedAt`, `timings`; nodes without timings are marks) together with
  a runtime trace.

### Revisions

- **v1** (2026-09-26, T40, proposed): the API, vocabulary, environment
  and policies above, with C-BUILD's `startedAt`. Migration: none (new).
  View and mount categories are not defined yet.

## C-EXT: typed native extensions

**Current version: v1 (proposed).**

A Lucent package can wrap a C library, or a C interface over C++, as a
native extension. Lucent code imports its functions and handles from
`lucent:ext/<name>` and calls them directly, from shared code too, since
both platforms build the C code into the one native package. The header
supplies the signatures; `lucent.json` says what C cannot. The full
field reference is in the package documentation; the contract is:

- **Declaration** (`lucent.json` `extensions.<name>`): `header`;
  `handles.<Class> { create, destroy, methods }`;
  `functions.<f> { params, failsWhen }`; `errors.<Struct> { code,
message, release }`; `affinity` (`any`, the default: any thread, one
  call at a time; or `main`) and `blocking`, per handle or function.
- **Header rules.** The header is in a directory both
  `ios.nativeSources` and `android.nativeSources` list, compiles as C and
  as C++, and declares its functions `extern "C"` when C++ includes it.
  `lucent build` reads it with clang (`$LUCENT_CLANG`, else `clang` on
  the `PATH`, else Xcode's, else the newest Android NDK's) and checks
  every name and shape the declaration uses; a mismatch fails the build,
  naming the package and the field.
- **Handles.** A handle is an opaque struct (declared, not defined).
  `create` returns a pointer to it (declare `failsWhen: "null"`) and is
  the constructor; `destroy` is `void f(T *)`; `methods` take the handle
  first. `close()` and `[Symbol.dispose]()` destroy it once, and so does
  its last reference going. Use after close throws `InvalidStateError`.
  A call holds its handles: a `close()` from another thread while it
  runs destroys the handle when the call returns. Handles never cross to
  JavaScript (LUCENT2006).
- **Parameters.** A pointer parameter is `bytes` read or written (a
  `Uint8Array`, its `length` parameter given the array's length), a
  UTF-8 `string` (`const char *`, TypeError if it holds NUL), or the
  `error` struct the call fills in. Numbers, booleans and handles need
  nothing. Nothing escapes the call.
- **Integers.** Wider than 32 bits (`long`, `size_t`, `int64_t` and their
  unsigned forms): bigints, exact. Others: numbers, checked as WebIDL's
  `[EnforceRange]` does (truncated toward zero; RangeError when not
  finite or out of range). Floats round as `Math.fround` does.
- **Failure.** `failsWhen`: `null`, `negative`, `nonzero`, `zero` or
  `false`. The call then throws an `Error` with the error struct's
  message (copied at once) and code, else `<f> failed`. With `nonzero`
  or `false` the result is a status and the Lucent function returns
  nothing. A function with an `error` parameter needs `failsWhen`. The
  struct's `release` runs after every call that takes it, once read.
- **Exceptions.** An exception escaping an extension function ends the
  process at the call, instead of unwinding through Lucent and JSI
  frames. Conversion errors (a closed handle, a number out of range)
  throw before the call.
- **Binding.** A header function whose signature needs no declaration
  (numbers and booleans) is bound as it is. One taking a handle must be
  named (in `functions` or as a method). One that cannot be bound (a
  callback, a variadic function, a struct by value) is listed at the end
  of the generated declarations with the reason, unless the declaration
  names it, which fails the build. Destroy and release functions are
  never Lucent code's to call.
- **Outputs.** `.lucent/native/types/ext/<name>.d.ts` (declarations for
  editors and tsc); `resolved.json` records each extension with its
  package, header hash and declaration; the build record's
  `extract:extensions` node lists the inputs its binding read.
- **Runtime** (`lucent/extension.h`):
  - `Handle::open(what, pointer, destroy, destroyOn)`; `use<T>()`
    returns a `Use<T>` that holds the pointer for one call;
    `close()` is idempotent; copies share one state (`identity()`).
  - `ext::` conversions: integers as `[EnforceRange]`, bigints exactly,
    floats as `Math.fround`, byte data never null, byte counts checked
    against their length type, string arguments as NUL-terminated
    UTF-8, C integer results as numbers (32 bits or fewer) or bigints.
  - The call wrapper ends the process on an escaping exception; the
    error helper throws what a failed call reports.

### Revisions

- **v1** (2026-09-26, T33, proposed): the declaration format, header
  rules, handles, conversions, failure conventions and outputs above.
  Open: Swift and Kotlin package sources are not typed by extensions,
  calls cannot be cancelled, and adopting extension memory as a
  `NativeBuffer` is left to C-BUFFER's `adopt`. Migration: none (new).

## Accepted decisions these contracts assume

- Swift value types cross as boxed references; there is no
  copy-into-struct path.
- Kotlin extension functions are plain functions taking the receiver
  first.
- No Xcode or Swift minimum beyond React Native's.
- Android callbacks use one reflection-based `NativeProxy`; generated
  listener classes come only if measurements show the proxy dominates.
- Packages ship sources only, and an app has one runtime.
- File kinds: modules in `.lucent.ts`, components in `.lucent.tsx`.
  `lucent:ui` is the single view entry point. Hosts accept React Native
  `style`; explicitly constrained sizing comes first.
- Events are void. Commands are a void enqueue or a promise result.
- Copy by default; fast buffers only through explicit ownership.
- The Kotlin metadata reader is Lucent's own TypeScript decoder (bindgen's
  `kotlin-metadata*.ts`); the official JVM library serves only as a test
  oracle.
- Every native 64-bit integer (Java `long`, `int64_t` and `uint64_t`,
  `NSInteger` and `NSUInteger`, Swift `Int`, `Int64` and `UInt64`)
  crosses as a bigint, except an integer of a constant group, which stays
  a number.
- SwiftUI and Compose views are written in Lucent, as JSX of the
  toolkit, with no wrapper call; a component is one file with `PLATFORM`
  branches, or split platform files.

## Fixed platform fundamentals

The no-catalog rule allows a fixed set of ABI and platform fundamentals:
things every platform program depends on, which no metadata could
describe. An inventory at the start of the work sorted name-based code
into three classes:

| Class                  | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rule                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| (A) Fixed fundamentals | Value bridging (`NSString`, `NSData`, `NSDate`, `NSNumber`, `NSError`, CoreFoundation toll-free types; Swift's `String`, `Data`, `Date`, `Array`, `Set`, `Optional`, `Error`, `CGFloat`, `NSInteger`); Swift standard protocols (`DataProtocol`, `ContiguousBytes`, `StringProtocol`, `Collection`, `Sequence`); `java.lang` `String`, `CharSequence`, `Class`, `Object`; `AutoCloseable` as `Symbol.dispose`; the `androidx.annotation` thread, permission and `@IntDef` vocabulary; the `NSObject` base; JNI and ARC plumbing; the runtime's platform files (`ClassLoader`, `Looper`, `NSThread`); `java.text.Collator` and `java.lang.String`'s locale case mapping for `localeCompare` and `toLocaleUpperCase`/`toLocaleLowerCase`; React Native TurboModule and package registration; the CoreFoundation link; CLI probes of Foundation and `android.os` that explain a missing SDK. | Allowed.                                                                                                |
| (B) Library inventory  | Adapters selected by library name: awaiting specific Java future types (Play services `Task`, Guava `ListenableFuture`, `CompletionStage`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Removed (T25), with regression tests; callback APIs go through `fromCallback` and package adapters.     |
| (C) Unclear            | The non-null annotation names (including third-party ones), the hidden-API lookup of the Android application context, the `SDK_INT` API-level guard by name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Left to the owning tasks; the annotation list and the application-context lookup are still in the code. |

The view work added fundamentals of the same kind: the root view classes
Fabric hosts (UIKit `UIView`, `android.view.View`), the slot container
classes (`UIView`, `android.view.ViewGroup`), and the toolkit roots
(`UIHostingController`, `ComposeView`). Each is a single entry per
platform, matched by SDK module and name; every other view class is
recognized by its ancestry.

# Native platform contracts

Lucent's native work is split across bindgen, the compiler, the C++
runtime, the React Native hosts and the CLI. Where two or more of them
meet, they implement one shared interface: a contract. This file states
each contract as the code implements it today. The design is
[native-platform.md](native-platform.md), the view runtime
[views.md](views.md), the observable behavior
[semantics.md](../semantics.md), and the code layout
[architecture.md](../architecture.md).

## How contracts change

- Each contract has a name and a version, which code cites
  (`C-BUFFER v1.4`). An interface several parts implement is written here
  before they implement it ("Contracts first" in
  [tasks.md](../tasks.md#requirements)).
- The commit that changes a contract's code changes its text and version:
  the minor version for an additive change, the major version for one
  consumers must follow, whose changeset says how to migrate.
- A **Planned** note names the open task that will change a contract.
- An interface written before its code is marked **Proposed**, with the
  task that implements it, until that code merges. This keeps contracts
  first: the entry-point ABI ([T130](../tasks.md#t130),
  [T114](../tasks.md#t114)) and new `lucent.json` fields (`launch`,
  `components[].class`) start here as proposals.
- History is in git; this file at commit `1f72821d` holds every earlier
  revision. Where code and text disagree, the code runs and the text has a
  bug.

## Summary

| Contract                                                     | What it covers                                                        | Version | Main code                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| [C-BIND](#c-bind-binding-schemas-and-plans)                  | SDK schemas, native identity, provenance, facts, binding plans, usage | v1.5    | `packages/bindgen/src/`                                     |
| [C-IR](#c-ir-semantic-ir-and-program-facts)                  | The semantic IR, its verifier, effect summaries, program facts        | v1.4    | `packages/compiler/src/ir/`, `analysis/`                    |
| [C-EXEC](#c-exec-execution-identities-scopes-and-operations) | Identities, scopes, operations, contexts, hosts, compute, channels    | v1.15   | `packages/runtime/cpp/lucent/`                              |
| [C-BIGINT](#c-bigint-the-runtimes-bigint)                    | The runtime's `BigInt` and native integer conversions                 | v1.1    | `lucent/bigint.h`                                           |
| [C-BUFFER](#c-buffer-native-buffers)                         | Native buffers, borrows, moves, loans, adoptions, native handles      | v1.7    | `lucent/buffer.h`, `handle.h`, `bytes.h`, `jsi/convert.*`   |
| [C-VIEW](#c-view-components-and-views)                       | Component descriptions, transport, mounts, hosts, toolkit bodies      | v3.0    | `packages/compiler/src/ui/`, `packages/runtime/cpp/rn/`     |
| [C-BUILD](#c-build-build-records-and-identities)             | Build records, pending actions, SDK locks, build identities           | v1.8    | `packages/lucent/src/cli/`, `compiler/src/emit/identity.ts` |
| [C-TRACE](#c-trace-correlated-tracing)                       | Correlated runtime and build tracing                                  | v1      | `lucent/trace.h`, `packages/lucent/src/cli/trace.ts`        |
| [C-EXT](#c-ext-typed-native-extensions)                      | C libraries a Lucent package declares                                 | v1      | `compiler/src/extensions/`, `lucent/extension.h`            |

`lucent/` paths are under `packages/runtime/cpp/`.

## Cross-cutting rules

These hold for every contract.

- **No curated catalog.** Behavior never depends on the name of an SDK,
  library, class, module or package, except for the
  [fixed platform anchors](#fixed-platform-anchors). The rest comes from
  metadata, general type rules, or an adapter a package writes. A test
  inventory is never an allowlist.
- **Unknown stays unknown.** Every fact defaults to `unknown`, and nothing
  is inferred from a name. An absent fact is never treated as safe.
- **One error path.** An internal invariant violation throws: an `Error`
  subclass in TypeScript, an exception in C++, reported through
  `reportUncaught` (`lucent/report.h`) where nothing can catch it. A
  problem in user code is a `LUCENT` diagnostic with an allocated code
  (`compiler/src/codes.ts`), never invalid C++.
- **Portable identities.** Schema provenance, build-record nodes, build
  identities and component identities hold no machine path. A path a
  message needs sits in a separate, unhashed field.
- **Copy by default.** Arrays, objects and bytes copy at the boundary.
  Each exception (a move, a loan, an adoption) is explicit, and C-BUFFER
  names it.
- **Thread ownership.** JSI values stay on their runtime's thread; other
  threads hold `Host` ids. The main thread never waits behind module code.
- **Generated C++.** It is built through `packages/codegen`. It never
  depends on unspecified evaluation order: the IR orders operations, and a
  plan's operands are lowered first, in source order (`operands` in
  `ir/lower.ts`). A coroutine never references lambda captures. Every
  build passes `-ffp-contract=off`, since JavaScript rounds `a * b + c`
  twice.
- **JavaScript semantics are the reference.** Native output must match the
  same source run as JavaScript. A deviation needs a reason in
  [semantics.md](../semantics.md) and a row in
  `apps/website/src/docs/language.ts`.

<a id="fixed-platform-fundamentals"></a>

## Fixed platform anchors

The no-catalog rule allows a small, fixed set of names: ABI and platform
fundamentals every program depends on, which no metadata describes. This
table lists the anchors found while writing this text. It is not
complete: [T152](../tasks.md#t152) audits every name in the compiler,
runtime, schema and build logic, records the full list here, and adds a
test that fails when a new name appears.

| Anchor                                                                                                          | Where                                                         | Why                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| UIKit `UIView`; `android.view.View`                                                                             | `ROOT_VIEWS`, `compiler/src/ui/roots.ts`                      | The class Fabric hosts mount. Other view classes are known by ancestry. |
| UIKit `UIView`; `android.view.ViewGroup`                                                                        | `SLOT_VIEWS`, same file                                       | The container a host makes for React children.                          |
| `UIHostingController`; `ComposeView`                                                                            | `TOOLKITS`, `compiler/src/ui/toolkits.ts`                     | The root views of SwiftUI and Compose bodies.                           |
| `androidx.compose.ui.UiComposable`                                                                              | `UI_APPLIER`, `bindgen/src/binding-plan.ts`                   | The applier of UI content; others are refused.                          |
| `NSData`, `NSDate`, `id`, `CFData`, `CFTypeRef`, `CFNumber`, `CFString`, `CFDictionary`, `CFArray`, `CFBoolean` | `named()`, `bindgen/src/schema.ts`                            | Value bridging to bytes, dates, strings, records and arrays.            |
| `androidx.annotation` `MainThread`, `UiThread`, `WorkerThread`, `AnyThread`                                     | `bindgen/src/android.ts`                                      | Thread facts.                                                           |
| `NonNull` annotations of `android`, `androidx`, `libcore`, JetBrains and `javax`                                | `NON_NULL`, `bindgen/src/android.ts`                          | Nullability. Some are third-party names: T152 classifies them.          |
| `NSObject`                                                                                                      | `compiler/src/emit/delegates.ts`, `emit/native.ts`            | The base class of generated delegates.                                  |
| `java.lang.AutoCloseable`                                                                                       | `emit/kotlin.ts`; `jni::close` in `lucent/platform/android.h` | What cancels a Kotlin coroutine shim, and what `using` disposes.        |
| `android.app.ActivityThread.currentApplication()`                                                               | `lucent/platform/android.cpp`                                 | The application context, through a hidden API. T152 classifies it.      |
| `android.os.Build.VERSION.SDK_INT`                                                                              | `compiler/src/emit/native.ts`                                 | API-level guards.                                                       |
| `java.text.Collator`                                                                                            | `lucent/jsstring.cpp`                                         | `localeCompare` on Android, as Hermes does it.                          |
| The TurboModule `Lucent`; `RCTViewComponentView`                                                                | `runtime/cpp/rn/LucentModule.h`, `LucentComponentView.h`      | React Native module and Fabric component registration.                  |

## C-BIND: binding schemas and plans

**Version: v1.5.** What bindgen produces and the compiler consumes: an
SDK module's declarations as data, their native identity, provenance and
facts, and a binding plan for each use of a member.

**Implemented by** `packages/bindgen/src/` (`schema.ts`, `provenance.ts`,
`artifacts.ts`, `facts.ts`, `binding-plan.ts`, `source-plan.ts`,
`call-form.ts`, `cache.ts`, `provider.ts`, `usage.ts`, `coverage.ts`). The
compiler takes every plan through `requirePlan` (`emit/native.ts`).

### Schema envelope

| Rule          | Contract                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format        | `SCHEMA_FORMAT = 1`. `SdkModuleSchema.format` holds the format its extractor wrote.                                                                                                                             |
| Cache         | Keyed on `extractorVersion()` (a hash of bindgen's sources) and the format. Another format is a miss, never an error. Entries publish whole; a partial file is a miss; one process extracts an entry at a time. |
| Other sources | `loadSchema` refuses another format: `<module>: unsupported binding schema format <N>; this Lucent reads format 1` (`none`, `<unknown module>` when missing).                                                   |
| Bumps         | A change older schemas would be read wrongly under bumps the format. An additive field does not: the extractor hash re-extracts.                                                                                |
| Order         | `canonicalSchema` sorts types, members, functions and constants by name, then symbol. Enum cases, fields and parameters keep their order.                                                                       |

### Symbol identity

| Scheme   | Form                                                                                               | From             |
| -------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| `swift:` | `swift:s:…`                                                                                        | symbol graph USR |
| `objc:`  | `objc:c:objc(…)…`                                                                                  | symbol graph USR |
| `c:`     | `c:c:…`                                                                                            | symbol graph USR |
| `jvm:`   | `jvm:<internal/Name>`, then `#<name><descriptor>` for methods or `#<name>:<descriptor>` for fields | class files      |

`symbol?` sits on every declaration kind, never derived from the printed
name. A declaration is its artifact and symbol, since artifacts may share
symbols; a call site adds the owner's symbol. A protocol extension's
member keeps the extension's symbol, an Android property its getter's,
and generic and inherited members the declaring one.

### Provenance

```ts
export interface SchemaProvenance {
  artifact: string; // `sdk:iphonesimulator27.0`, `pod:OrbitKit@1.2.0`, `maven:g:a:v`, `android-sdk:35`
  kind: "sdk" | "framework" | "clang-module" | "swift-module" | "jar" | "aar" | "sources";
  contentHash?: string; // of the artifact's declaration inputs
  target: string; // `arm64-apple-ios15.1-simulator`, `android-35`
  extractor: string; // extractorVersion()
}
```

| Part             | Contract                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per module       | One provenance per module. What reading it consulted is `sdkModuleArtifacts(platform, module)`, not a schema field.                                                                                                  |
| `NativeArtifact` | An artifact as the build resolved it (`artifacts.ts`). `id`, `kind`, `contentHash`, `targetTriple`, `dependencies` and `modules` identify it; the other fields are machine-local. `identity(a)` is `id#contentHash`. |
| Artifacts        | iOS: the SDK, then one per pod, Swift package or module on the search paths. Android: the SDK platform, then each jar or AAR, hashed on its entries' names and CRCs.                                                 |

### Native facts

`NativeFacts` sits on members and functions. A class's facts cover members
without their own (`memberFacts`); absent facts are `UNKNOWN_FACTS`.

| Fact             | Values                                           | Source                                                                                     |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `affinity`       | `main`, `worker`, `any`, `unknown`               | `@MainThread`, `@UiThread`, `@MainActor`: main; `@WorkerThread`: worker; `@AnyThread`: any |
| `blocking`       | `yes`, `no`, `unknown`                           | A thread annotation leaves it `unknown`.                                                   |
| `callbackTiming` | `during-call`, `escaping`, `unknown`             | Per callback value, in a `callback` plan's `detail` (`, main thread` appended).            |
| `ownership`      | `borrowed`, `retained`, `transferred`, `unknown` | The rules `objc-method-family` and `cf-create-rule`.                                       |
| `evidence`       | `{ fact, source, detail }[]`                     | `source` is `annotation`, `attribute`, `metadata`, `abi` or `convention`.                  |

The older `mainActor` and `worker` flags derive from the same facts
(`classThreadFlags`, `memberThreadFlags`), so they cannot disagree.

### Kotlin and Swift facts

| Type                | On                                  | Fields                                                                                                                                                                          |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SwiftType`         | `SdkClassSchema.swift`              | `kind`, `associatedTypes`, `primaryAssociatedTypes`, `cases`, `propertyWrapper`                                                                                                 |
| `SwiftMember`       | callables' and properties' `swift`  | `name` (`distance(to:)`), `async`, `throws`, `mutating`, `bytes`, `ownerArgs`                                                                                                   |
| `SwiftParamFacts`   | `SdkParam.swift`                    | `label`, `kind` (`value`, `action`, `builder`)                                                                                                                                  |
| `KotlinClassFacts`  | `SdkClassSchema.kotlin`             | `kind`, `data`, `fun`, `sealed`, `value`, `bounds`, `upperBounds`, `scope`, `companionValue`                                                                                    |
| `KotlinMemberFacts` | callables' and properties' `kotlin` | `suspend`, `extension`, `unboxed`, `bounds`, `upperBounds`, `property`, `composable`, `applier`, `inline`, `reified`, `optIn`, `restricted`, `varargShadowed`, `omits`, `scope` |
| `KotlinParamFacts`  | `SdkParam.kotlin`                   | `default`, `suspendFunction`, `role` (`content`, `callback`), `receiver`, `vararg`, `returnsThrough`, `changedBy`                                                               |

`upperBounds` writes a bound as a shim would (`KotlinTypeRef`).
`SdkMethodSchema.java` is the JVM name when it is not `name`. Extension
functions are static members of their facade class, receiver first.

### Schema types

`SchemaType` kinds: `prim`, `string`, `array` (`list` for a Kotlin
`List`), `set`, `tuple`, `bytes`, `date`, `id`, `record`, `out`,
`classOf`, `fn`, `error`, `tparam`, `ref` and `sequence` (a Swift
`AsyncSequence`). `long`, `NSInteger`, `NSUInteger`, `int64` and `uint64`
are bigints (`isBigIntType`), unless an integer of a constant group
(`group: true`, `markGroupIntegers`) keeps them numbers. A 64-bit
constant's `value` is its decimal digits. Glue takes signedness from the
real C type (`decltype`), since symbol graphs type some unsigned fields as
`Int`.

### Binding plans

`binding-plan.ts` derives a plan for each use of a member, by type and ABI
rules. The compiler refuses a use, documents a declaration and emits glue
from the same plan. Coverage counts what plans refuse.

```ts
export type Backend =
  "objc" | "jni" | "swift-shim" | "kotlin-shim" | "c-abi" | "kotlin-source" | "swift-source";
export type Role = "call" | "new" | "get" | "set" | "implement";
export type Delivery = "sync" | "queued"; // sync: native code waits, holding the actor's lock

export interface ConversionPlan {
  op: ConversionOp;
  type: SchemaType;
  of?: ConversionPlan[];
  detail?: string;
  reason?: string; // exactly when op is "unsupported"
  omissible?: true; // refuses only uses that give or take it (takenReason)
  delivery?: Delivery;
  exact?: true; // a constant group's 64-bit integer kept a number: exact, or RangeError
}

export interface BindingPlan {
  symbol?: SymbolId;
  display: string; // `UIDevice.batteryLevel`
  backend: Backend;
  role: Role;
  artifact?: string;
  receiver?: ConversionPlan;
  inputs: ConversionPlan[];
  output: ConversionPlan;
  error?: ConversionPlan & {
    op: "error";
    detail: "nserror-out" | "swift-throws" | "java-exception";
  };
  refused?: { rule: string; reason: string };
  delivery?: Delivery; // a requirement a Lucent class implements
  facts: NativeFacts;
  availability?: { platform: Platform; since: number | string };
  requiredArtifacts: string[];
}
```

`ConversionOp` is `passthrough`, `number`, `bigint`, `copy-string`,
`copy-bytes`, `copy-array`, `copy-record`, `copy-set`, `copy-tuple`,
`copy-date`, `retain-object`, `box-swift-value`, `optional`,
`tagged-union`, `enum`, `struct`, `sequence`, `out`, `callback`, `error`
or `unsupported`. `TypeFacts` (`kind`, `cf`, `swift`, `typeParams`,
`artifact`) is what a plan knows of a type a member names.

| Rule          | Contract                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry points  | `planMember(owner, member, module, lookup, role?)`, `planBinding(…, types: TypeLookup, role?)`, `planConversion`, `unsupportedReason`, `takenReason`, `explainRefusal`.                                                                               |
| Derived data  | Plans are never cached with a schema. Emitters have no use-site checks of their own.                                                                                                                                                                  |
| Default role  | `new` for a constructor, `get` for a property, else `call`.                                                                                                                                                                                           |
| Unknown facts | A lookup that cannot tell a fact leaves it out, and no rule refuses on it.                                                                                                                                                                            |
| Backend       | `form: "source"`: `swift-source` or `kotlin-source`. Swift-only member: `swift-shim`. Android: `kotlin-shim` for suspend, unboxed value classes or suspend parameters, else `jni`. iOS: `c-abi` for C functions, CF handles and globals, else `objc`. |
| Explanations  | `explainRefusal` gives `<display>: <reason> (<symbol> in <artifact>)`. A plan's reason equals coverage's, as a golden test checks.                                                                                                                    |

Member-level refusal rules, each a general rule that names no library:

| Backend         | Rules                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| any, role `set` | `read-only`; `java-field-write` (JNI); `no-setter` (Objective-C, C)                                                                                                                                                          |
| `jni`           | `jvm-mangled-name`                                                                                                                                                                                                           |
| `swift-shim`    | `async-initializer`, `static-requirement`, `associated-types`                                                                                                                                                                |
| `kotlin-shim`   | `kotlin-shim-generic`, `kotlin-shim`                                                                                                                                                                                         |
| `kotlin-source` | `kotlin-source-implement`, `kotlin-source-set`, `kotlin-reified`, `kotlin-opt-in`, `kotlin-restricted`, `kotlin-member-extension`, `compose-applier`, `kotlin-extension-receiver`, `kotlin-vararg`, `kotlin-receiver-result` |
| `swift-source`  | `role`, `property-wrapper`, `builder-arguments`                                                                                                                                                                              |

`associated-types` refuses a protocol's static members, and its members
whose closures take or give its associated types. Other members are
called on the value opened as the type conforming
([0114](../decisions/0114-a-protocols-member-is-called-on-its-value-opened.md)).

`SdkModuleSchema.form: "source"` marks a module generated Swift or Kotlin
calls as its own language would: SwiftUI's views, modifiers and values,
and Compose's content. `callForms(params)` (`call-form.ts`) is the one
rule for the argument shapes such a call takes; `planSource` plans the iOS
ones.

### SDK usage, locks and diffs

`usage.ts` (`USAGE_FORMAT = 1`) describes SDK symbols as an app depends on
them:

| Type         | Fields                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SdkSymbol`  | `platform`, `module`, `owner?`, `kind` (type, constructor, method, property, function, constant), `name`, `static?`, `symbol?`, `signature`, `since?`, `deprecated?`, `cases?` |
| `UsedSymbol` | `SdkSymbol` and `roles?`                                                                                                                                                       |
| `UsedModule` | `artifacts` (`id#contentHash`, sorted), `schema?` (`<scope>/<entry>`)                                                                                                          |
| `SdkUsage`   | `format`, `targets`, `modules` (`<platform>/<module>` → `UsedModule`), `symbols` (sorted by `symbolKey`)                                                                       |

- `symbolKey(s)` is `<platform>/<module>/<owner>/<kind>:<id>`, `id` being
  the native symbol or `[static ]<name> <signature>`.
- `diffSymbols` and `diffModule` report each symbol `removed`, `changed`
  (the differences in words), `unchanged` or `added`.
  `compareArtifacts` lists modules whose artifacts differ from a lock's.
- Coverage stages are `discovered`, `representable`, `generated` and
  `exercised`; one without evidence is `null`.

### Planned

- [T143](../tasks.md#t143) binds a package's Kotlin and Java sources as
  `lucent:android/<package>`, from a jar keyed on their content.

## C-IR: semantic IR and program facts

**Version: v1.4.** The compiler's semantic intermediate representation,
and the analysis later stages consume. A value is defined once by an
operation and referred to by id. Operations run in their region's order,
so evaluation order is data.

**Implemented by** `packages/compiler/src/`: `ir/` (`ir.ts`, `build.ts`,
`dump.ts`, `lower.ts`, `verify.ts`, `cpp.ts`), `emit/leaf.ts`,
`lowering/conversions.ts` and `analysis/`. Tests: `compiler/test/ir/`.

The IR imports `types.ts` and `typescript`, never `emit/**`; the emitter
reaches `ir/cpp.ts` through `emit/through-ir.ts` alone. Every function,
method, accessor, constructor, module `init()`, compute task variant and
component setup lowers through the IR. What it cannot lower throws
`IrUnsupported`, reported as LUCENT1001.

### Data model

```ts
export type ValueId = number & { readonly __value: true }; // dense per function, as are the next three
export type RegionId = number & { readonly __region: true };
export type PlaceId = number & { readonly __place: true }; // a local or module variable
export type TargetId = number & { readonly __target: true }; // a loop or block
export type FunctionId = string; // the C++ name
export type OwnerId = "legacy-module" | "main" | "task" | "unknown";
export type IntKind = "i32" | "u32" | "i64";
```

| Type            | Fields                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IrValue`       | `id`, `type` (`LType`), `source`, `owner?`, `int?` (an exact integer register), `elements?` (an array of them), `onStack?`                           |
| `IrFunction`    | `id`, `params`, `result`, `body`, `values`, `regions`, `modulePlaces`, `captures`, `effects`, `source`, `elsewhere?`, `async`, `generator?`, `site?` |
| `IrRegion`      | `id`, `ops`, `parent?`                                                                                                                               |
| `IrModulePlace` | `place`, `symbol`, `name`, `type`, `mutable`                                                                                                         |
| `IrCapture`     | `place`, `name`, `type`, `boxed`, `spelled?`                                                                                                         |
| `SourceSpan`    | `file`, `start`, `end`, `line`, `column`                                                                                                             |

| Op (`IrOp`, each with `source`)                                | Meaning                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `const`, `param`                                               | A constant; a parameter.                                                      |
| `unary`, `binary`                                              | The `UNARY` and `BINARY` tables. `!!` is ToBoolean, `String` ToString.        |
| `convert`                                                      | A representation change only (`lowering/conversions.ts`).                     |
| `local`, `load`, `store`                                       | A local (`boxed`, `int`, `elements`, `onStack`); reads and writes of a place. |
| `renew`                                                        | A boxed `for (let …)` variable gets its own box per iteration.                |
| `call`                                                         | A function or a `BUILTINS` entry, with its `EffectRef`.                       |
| `if`, `loop`, `block`                                          | Structured control flow over owned regions.                                   |
| `try`, `dispose`                                               | Exceptional edges; a `using` disposal, in a finally only.                     |
| `iterate`                                                      | `for … of`; leaving early closes an iterator.                                 |
| `return`, `throw`, `break`, `continue`, `yield`, `unreachable` | Terminators. `yield` ends an `if` branch with its result.                     |
| `return` with `adopt`                                          | An async function's `return p`, through a `convert` function when given.      |
| `plan`                                                         | An operation the backend writes, on operands computed before it.              |
| `closure`                                                      | A function value of a nested `IrFunction`; it `enters` a setup's mount.       |
| `await`, `produce`                                             | An async suspension, of a promise or any value; a generator's element.        |
| `never`                                                        | The value of what never completes.                                            |

| Lowering rule | Contract                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans         | What the IR does not model: a member access, a runtime or SDK method, a construction, a literal. Operands are lowered once each, in source order, before it. A plan runs none of the program's code and decides no order.                   |
| `LeafHost`    | `plan`, `elements`, `onStack`, `convert`, `converter`, `place`, `part`, `keys`, `link`, `safepoint`, `step`, `absent`, `equals`, `superCall`, `dispose`, `whole`, `platformOnly`. `LeafOperands`: `operand`, `closure`, `ambient`, `thunk`. |
| Places        | A non-variable place is read before the right side runs (`LeafHost.place`). Optional chains lower link by link.                                                                                                                             |
| Closures      | A capture is a value copied at creation, or the enclosing box of a variable written after capture.                                                                                                                                          |
| Async         | A function with no `await` is no coroutine and returns a settled promise. A coroutine never suspends in a C++ catch handler. Its promise adopts a returned promise once the function has finished, past its `finally` blocks.               |
| Targets       | A compute variant has a safepoint per loop iteration. The host decides platform tests (`platformGuard`, `platformClauses`, `runsHere`); only the target's code is lowered.                                                                  |

### Verifier invariants

`verify(fn, env?)` throws `IrVerifyError`, with the dump, on any of these;
no C++ is produced. `VerifyEnv` may give `signature(id)`, `effects(id)`
and `isError(t)`.

1. Every value and local is defined once, earlier in its region or an
   enclosing one. Each region but the body has one owner.
2. Types agree with each operation and callee signature. A store into a
   constant module place is refused.
3. Terminators end their region. `break` names an enclosing loop or block,
   `continue` a loop (never from its `next`). Conditions are booleans.
4. Every operation and value has a span in the function's, or in
   `elsewhere`.
5. Operands are value ids, never nested expressions.
6. An `int` register holds a number; `elements` and `onStack` values are
   seen only by plans.
7. Nothing claims less than it does: effect references and the summary
   admit every exit, read and write. A plan's effects are the analysis's.

### Effect summary

```ts
export interface EffectSummary {
  reads: "none" | "module" | "unknown";
  writes: "none" | "module" | "unknown";
  allocates: boolean | "unknown";
  throws: "no" | "yes" | "unknown";
  suspends: boolean;
  callbacks: "none" | "known" | "unknown"; // known: also parameters the caller binds
  affinity: "any" | "main" | "unknown";
  native: "none" | "known" | "unknown";
}
```

Module state is a `let`, a non-readonly static, or a `const` holding an
object. The analysis keeps a richer `Summary` (`analysis/facts.ts`), each
fact with its first `Cause`, adding `mutates`, `schedules`, `invokes`,
`blocking`, a `worker` affinity, `calledBack`, `escapes` and `returns`.
`effectSummary` projects it; a worker or mixed affinity becomes
`"unknown"`.

### Program facts

`programFacts(lp)` analyses a program once per `ts.Program`. `analyze`
takes an `AnalysisInput`: `checker`, `modules`, `platform?`, `native?`,
`posts?` (calls that hand their arguments on, such as an event prop) and
`mainRoots?` (setups and their commands).

| `ProgramFacts` member                            | Gives                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `units`, `unit(node)`, `byId(id)`                | Every function, method, class construction and module initialization.                                   |
| `summary(unit)`, `effects(unit)`                 | The analysis summary; its IR record.                                                                    |
| `owners(unit)`                                   | The contexts that may run it, each with why. A helper takes its callers'. `executor` for `on()`'s code. |
| `executorClasses()`                              | The classes whose instances go on an executor (`on(exec, new C(…))`), with those calls.                 |
| `check(unit, "task" \| "main" \| "executor")`    | Why it cannot run there. Backs LUCENT3011, LUCENT3012, LUCENT3022 and LUCENT3032.                       |
| `captures(unit)`, `checkCaptures(unit, context)` | What a closure captures; why that cannot go with it.                                                    |
| `transfer(type, name)`                           | Why a value cannot cross to another context.                                                            |
| `escapes(symbol)`                                | How a variable's value outlives its unit. Backs LUCENT3030.                                             |
| `mainState()`                                    | Top-level variables only `main`-owned units use, holding plain or native values or collections of them. |

### Planned

- [T120](../tasks.md#t120): `mainState` extends to instance members only
  main-thread code touches.
- [T106](../tasks.md#t106): a generator's `yield` value, its `return v`
  and `throw()`.

## C-EXEC: execution identities, scopes and operations

**Version: v1.15.** The runtime's model of who owns work and where it runs,
in namespace `lucent`, with no JSI type but `lucent/jsi`'s `Host`. The text
at this version also covers `channel.h` and `hooks.h`, which shipped
before the text named them. v1.9 added `handed.h`, v1.10
`delegate_events.h`, v1.11 the kept `relaunched` event and the
notification delegate's events, v1.12 `native_root.h`, v1.13
`entries.h`, v1.14 its `launch`, and v1.15 `entry_types.h`, the C types
it passes, which Swift imports.

**Implemented by** `packages/runtime/cpp/lucent/`: `scope.h`,
`execution.h`, `scheduler.h`, `native.h`, `native_root.h`, `entries.h`, `entry_types.h`, `handed.h`, `delegate_events.h`, `async.h`, `abort.h`,
`resource.h`, `callback.h`, `transport.h`, `compute.h`, `channel.h`,
`lifecycle.h`, `presentation.h`, `hooks.h`, `report.h`, `jsi/host.h`.

### Identities

```cpp
using RuntimeId = uint32_t;    // 0: no JS runtime
using ScopeId = uint64_t;      // process-unique, never reused; 0 is none
using Generation = uint32_t;   // per scope; changes when it is disposed
using OperationId = uint64_t;  // process-unique, never reused; 0 is none
using ContextId = uint32_t;    // process-unique, never reused; 0 is none
struct OperationToken { RuntimeId runtime; ScopeId scope; Generation generation; OperationId operation; };
```

A token is valid only while all four fields match a live scope and the
operation is pending there (`Scope::validates`), never by pointer or tag
alone.

### Scope

A `Scope` owns work that ends with its owner: children, pending operations
and cleanups. It moves one way: `Active` → `Disposing` (generation
changed, registrations refused) → `Disposed`.

| Member or rule               | Contract                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(runtime, parent?)`   | A child takes its parent's owner. Under a parent with a runtime, another `runtime` throws `std::invalid_argument`. Under an inactive parent it starts disposed.                    |
| `createRoot(runtime, owner)` | A root owned by a `Scope::Owner` (`isCurrent()`, `post(job)`).                                                                                                                     |
| `onDispose(cleanup)`         | Registers a cleanup. On an inactive scope it runs now, its error reaching the caller, and returns 0. `remove(id)` takes one back.                                                  |
| `dispose()`                  | Idempotent. Disposes children and cancels operations (newest first), runs their cleanups, then its own in reverse. Errors aggregate as `using` does.                               |
| `registrations()`            | Live children, pending operations and cleanups not run.                                                                                                                            |
| References                   | A parent holds children strongly, a child its parent weakly. The last reference to an active scope disposes it; errors are reported.                                               |
| Threads                      | Any thread. With an owner, a `dispose()` elsewhere posts there and returns `nullptr`; the scope stays active until it runs. A `dispose()` that finds it disposing returns at once. |
| Recycling                    | Disposal plus a new child scope.                                                                                                                                                   |

### Operation

`Operation<T>` is one pending native request with exactly one outcome.
`T` may be `void`; errors are `lucent::Error`.

```cpp
enum class OperationState : uint8_t { Pending, Succeeded, Failed, Cancelled };
struct Outcome { OperationState state; std::optional<Value> value; Error error; };
using Registration = std::function<std::function<void()>(const std::shared_ptr<Operation>&)>;  // returns the cleanup
static std::shared_ptr<Operation> start(const std::shared_ptr<Scope>&, const Registration&, Opt<Error> abortedBy = {});
bool succeed(Value); bool fail(Error); bool cancel(Error);  // true only for the call that settles it
void onSettled(std::function<void(const Outcome&)>); void setCleanup(std::function<void()>);
void onLateOutcome(std::function<void(Value&&)>); OperationToken token() const; uint64_t lateOutcomes() const;
```

| Rule       | Contract                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settlement | One compare-and-swap leaves `Pending`. A later outcome is counted (`lateOutcomes()`) and its value released, never delivered.                          |
| Cleanup    | Runs exactly once, after settlement. `setCleanup({})` removes one not yet run.                                                                         |
| Listeners  | Run once, in order, on the settling thread; one added late runs at once.                                                                               |
| Start      | Already aborted (`abortedBy`) or under an inactive scope, it starts `Cancelled` without calling the registration. A registration that throws fails it. |
| Disposal   | Scope disposal cancels it with `scopeDisposedError()` (an AbortError), then runs its cleanup.                                                          |
| Errors     | Listener and cleanup errors are reported, except under `Scope::dispose`, which returns them.                                                           |

### Execution contexts

A context runs Lucent code one turn at a time: a job, then its
microtasks. Each has its own queue, microtask queue and root scope, and
owns its scopes.

| Context        | Class                       | Runs on                                                                         | Takes an actor's lock |
| -------------- | --------------------------- | ------------------------------------------------------------------------------- | --------------------- |
| Module actor   | `Actor` (`scheduler.h`)     | Its own thread, started with its first job; entered from any thread by its lock | Its own               |
| Main           | `ExecutionContext::main()`  | The platform's UI loop; a stand-in thread on hosts                              | Never                 |
| Isolated       | `IsolatedContext`           | A thread of its own                                                             | No                    |
| Executor       | `ExecutorContext`           | A serial dispatch queue on Apple platforms, else its own thread                 | Never                 |
| Compute worker | `ComputePool` (`compute.h`) | A pool thread, an isolated context                                              | Never                 |

| Member                                 | Contract                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current()`, `currentRef()`, `of(ref)` | The innermost actor whose lock the thread holds, else the context it entered. A null `ContextRef` is the shared actor.                                                 |
| `post(job[, owner])`                   | A turn, from any thread; false if stopped. With `owner`, dropped if it was disposed first.                                                                             |
| `postDelayed(ms, job)`                 | A turn later.                                                                                                                                                          |
| `enqueueMicrotask`, `drainMicrotasks`  | On the context itself only (`std::logic_error` elsewhere).                                                                                                             |
| `ContextEntry`                         | Enters a non-actor context on its own thread, for a callback that must answer now; the outermost exit runs its microtasks.                                             |
| `shutdown()`                           | Isolated and executor contexts: no more work, root disposed on their thread, queue dropped, returns at once.                                                           |
| `ExecutorContext`                      | `create(label)`, `label()`, `platformQueue()` (its `dispatch_queue_t`, else null), `execute(job)` (platform work outside a turn; the glue enters with `ContextEntry`). |
| `detail::runOn(context, job)`          | Here when on that thread (or none, or one taking no work), else posted.                                                                                                |
| Threads                                | Lucent's own get `kThreadStackSize` (8 MB) and, on Apple platforms, an autorelease pool per job. A dispatch queue's stack is the system's (512 KB on iOS).             |

### Actors and the main thread

| Rule          | Contract                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actors        | Each import component (a package, or the app's modules) gets one (`lucent_app::actor_N`); other code runs on `Actor::shared()`. Never destroyed. The compiler calls this owner `legacy-module`. |
| Lock          | Every entry into module code holds its actor's `LucentLock`, a recursive, fair ticket lock (`LucentScope`).                                                                                     |
| Waits         | Code holding a lock waits for nothing but another actor's lock. A wait that would close a cycle throws `Lucent: deadlock: …`.                                                                   |
| Main thread   | Never takes a ticket. Deferred work runs once the lock is free (`enterFromMain`); work that must answer waits only for the holder (`lockFromMain`), with a debug warning past 50 ms.            |
| Lending       | A synchronous JavaScript callback lends its thread's actors to the main thread (`ParkedActors`).                                                                                                |
| Cross-context | No synchronous waits: not UI to JavaScript, UI to worker, nor JavaScript to UI.                                                                                                                 |

| Entry (`native.h`)        | Contract                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `postCallback(actor, f)`  | A callback returning nothing: a turn of the actor.                                                                 |
| `callNow(actor, f)`       | A callback the platform waits for: here, under the lock. An error is reported; the platform gets a default result. |
| `enterFromMain(actor, f)` | On the main thread, once the lock is free or lent.                                                                 |
| `runOnMain(f)`            | `lucent:thread`'s `main(f)`: `f` on the main thread under the caller's actor, as a promise.                        |
| `postTo(context, f)`      | A turn of a non-actor context.                                                                                     |
| `callNowIn(context, f)`   | Now, on the context's own thread; from another thread, reported with a default result.                             |
| `enterOrPost(context, f)` | An executor's function (`on(exec, f)`) returning nothing: now on the executor, else a turn of it.                  |
| `handedFunction(x, f)`    | `const g = on(x, f)`: `f`, keeping `x` and, by `madeAs(type, make)`, one platform object per type (`handedOf(g)`). |
| `runIn(context, f)`       | A turn there, settling a promise of the caller's context; a stopped context rejects.                               |

### JavaScript runtimes and module scope

Module code's work belongs to the JavaScript runtime it runs for. A reload
cancels that runtime's work only, and two React Native instances keep
their own.

| Part                               | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeWork`                      | A runtime's work, a scope per actor; `Host` and `NativeCall` implement it. `attachRuntime(id, work)`, `detachRuntime(id)`, ids from `newRuntimeId()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `RuntimeEntry`, `currentRuntime()` | A thread runs for the runtime whose call it is in; posts carry it. Elsewhere: the last attached live JavaScript runtime, else the last attached.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `moduleScope()`                    | That runtime's scope on the calling actor; the actor's root with none attached; disposed once its runtime is torn down.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ownedScope(owner)`                | Where promise-returning APIs register work: an actor's module scope, or another context's root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `onDestroy(hook)` (`hooks.h`)      | Registers under the current generation. `runDestroyHooks(generation)` runs them last first, each holding its actor, as it ends. A throw is reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Module state (`native_root.h`)     | The process's, in generations (0090). `ensureModuleState(init)` starts one when none lasts; `endModuleStateUnlessHeld` ends it in the last runtime's teardown, unless a `ModuleStateHold` holds it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `NativeCall`                       | A native call's work: a runtime of its own, never the default, no JavaScript runtime to `otherRuntimes`. Holds module state; `end()` disposes its scopes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Entry points (`entries.h`, 0091)   | `lucent_<module>_<export>` in the generated `lucent_entries.h`. `entries::call` and `callAsync` run one as a `NativeCall` that starts state with `lucent_app::initModules`; the error goes to the caller; what Lucent passes lasts until the thread's next entry, or the completion's return. An optional, array, record or platform object is a `lucent_value` (0116), converted by `numberIn`, `arrayIn<T>(…)`, `optionalOut(…)` and the like; a wrong kind is a TypeError; `nativeIn` and `nativeOut` are the platform's. An exported class's instance is a `lucent_object` (`adopt`, `instanceIn<T>`), owned by the caller an entry gives it to until `lucent_release`. |
| Launch (`entries.h`, 0092)         | `lucent_launch()`, which iOS's `LucentAppDelegate` calls first, and Android's `LucentInitializer` through `LucentLaunch.launch()` once it loaded `appmodules` (0095): with launch modules, `entries::launch` starts state on the main thread once and holds it for the process; without, nothing.                                                                                                                                                                                                                                                                                                                                                                           |

### Promises, references and resources

| Part                                                | Contract                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promises (`async.h`)                                | State changes only on the context that made it. A continuation resumes, from the microtask queue, on the context that registered it, or is dropped if that one stopped.                                                                                       |
| `AbortSignal` (`abort.h`)                           | Belongs to the context that made it; changes from elsewhere are posted there.                                                                                                                                                                                 |
| `fromCallback`, `subscribe` (`callback.h`)          | One `Operation` each, under the caller's `ownedScope`. The registration returns its cleanup, maybe none. Calls from other threads are posted in order; the first to take effect wins. The cleanup runs in the settling call, or right after the registration. |
| `subscribe`'s end                                   | The first of `end`, `fail`, a throwing `onValue` and the signal, which resolves it. A reported promise is LUCENT1007.                                                                                                                                         |
| `NativeRef(handle, release, same, releaseOn?)`      | Owns a platform object, released with the last copy on `releaseOn`'s thread. `same`: pointers on iOS, `IsSameObject` on Android.                                                                                                                              |
| `Resource::open(what, release, releaseOn?, scope?)` | `Open`, `Closing` while its release runs, `Closed`. Closes at the first of `close()`, its scope's disposal and its last reference; the release runs once; `close()` never waits. Then use throws `InvalidStateError` "`<what>` is closed".                    |

### Hosts

`lucent::js::Host` (`jsi/host.h`) is made per JS runtime, on its thread,
and owns every JSI object Lucent keeps.

| `Host` member                | Contract                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(rt, poster)`         | One per runtime; an earlier host is invalidated and replaced.                                                                                                                                                                             |
| `id()`                       | Nonzero, never reused: the `RuntimeId` its scopes and tokens carry.                                                                                                                                                                       |
| `scope()`, `scopeFor(actor)` | The roots of its work on the shared actor and on each actor.                                                                                                                                                                              |
| `postToJs(task, dropped?)`   | On the JS thread unless torn down first; a dropped task is released on the calling actor.                                                                                                                                                 |
| `postToModule(actor, job)`   | A turn of `actor` unless torn down before it starts.                                                                                                                                                                                      |
| `invalidate()`               | Rejects owed promises with an AbortError of its own ("Lucent was torn down…"), disposes its scopes, drops JSI references. Teardown from the runtime's end runs no JavaScript. Lucent code still waiting on JavaScript gets `goneError()`. |
| `retain`, `retainValue`      | Ids for JS functions and values; `release` and `releaseValue` work from any thread.                                                                                                                                                       |
| `ownership()`                | `runtime`, `promises`, `callbacks`, `identities`, `prototypes`, `modules`, `registrations`, `inFlight`, `values`, `releasedOpen`.                                                                                                         |

`instanceOf(rt, v)` throws `TypeError` for an object a torn-down host
made. A `JSValue` is a `HeldJsValue`, released on the JS thread with its
last reference. `Convert<JSValue>` gives the same value back and refuses
one of a replaced host. `strictEquals`, `toJsString`, `truthy` and
`jsonWrite` of one throw `TypeError` (`throwOpaque`).

### Transport and compute

| Part                | Contract                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Transport<T>`      | `static T copy(const T&, CopyGraph&)`. `Transportable<T>` refuses functions, promises and signals.                                                                 |
| `CopyGraph`         | Keeps aliases and cycles; `onCommit(commit, rollback)` registers two-phase moves.                                                                                  |
| `transportObject`   | The exact dynamic type; a subclass behind its base type is a `DataCloneError`. Strings and bigints are shared; views of one buffer stay views of one copy.         |
| `compute`, `submit` | `compute(entry, input, options)` copies the input; `submit` takes it owned. `TaskEntry<In, Out> { name, run }` is what the compiler emits.                         |
| `ComputeOptions`    | `{ signal, scope, pool }`, defaulting to the caller's `ownedScope` and `ComputePool::shared()`.                                                                    |
| `TaskContext`       | `cancelled()`, `checkCancelled()` (a safepoint throwing AbortError), `current()`, a `scope()` disposed before the result leaves.                                   |
| `ComputePool`       | `create({ workers, capacity })`, `shared()`, `kDefaultCapacity = 1024`, `shutdown()`, `stats()`, `setTimingSink`, `admit`. Workers number cores − 1, at least one. |
| Errors              | `QuotaExceededError` when the queue is full (the caller never blocks), `InvalidStateError` for a closed pool, `AbortError` for shutdown, signal or scope.          |
| Settlement          | Once, on the owner. A loser is released on the worker, or on the owner once posted. Native code between safepoints runs on.                                        |

### Channels

`ChannelObject<T>` (`lucent:core`'s `Channel`) carries values from a
producer on any thread to a consumer on its own context. A send never
waits.

| Policy     | When full                                                    |
| ---------- | ------------------------------------------------------------ |
| `Lossless` | The send is refused (false); the value stays the producer's. |
| `Latest`   | One slot; a send replaces the waiting value.                 |
| `Drop`     | The oldest waiting value is dropped.                         |

| Member                             | Contract                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `create(policy, capacity, scope?)` | A whole capacity from 1, and 1 for `Latest` (`RangeError` otherwise). Lucent's default is 16, under `ownedScope`. |
| `send`, `sendCopy`                 | `sendCopy` copies as a task input is; a `NativeBuffer` moves. A refused send copies and moves nothing.            |
| `receive()`                        | On the calling context: at once if a value waits, else when one comes; `undefined` once closed and drained.       |
| `subscribe(onValue)`               | One value at a time; a throw is reported and the next comes.                                                      |
| `close()`                          | Refuses sends; queued values are still received. Its scope's disposal or last reference closes it too.            |
| Release                            | A dropped or unreceived value is released at once: a `NativeBuffer` is closed.                                    |
| `stats()`                          | `sent`, `received`, `dropped`, `refused`, `depth`, `highWater`.                                                   |

### Lifecycle and presentations

`lifecycle.h` is a pure C++ core that `platform/ios_ui.mm` reports to. A
scene is a `SceneId`, never a pointer.

| Enum         | Values                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `AppEvent`   | `DidBecomeActive`, `WillResignActive`, `DidEnterBackground`, `WillEnterForeground`, `DidReceiveMemoryWarning`, `WillTerminate` |
| `SceneEvent` | `WillConnect`, `DidDisconnect`, `DidActivate`, `WillDeactivate`, `WillEnterForeground`, `DidEnterBackground`                   |
| `SceneState` | `Unattached`, `ForegroundActive`, `ForegroundInactive`, `Background`                                                           |

| Member                               | Contract                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect()`, `report(…)`             | Main thread only (`std::logic_error` elsewhere). A scene gets an id and a scope; `DidDisconnect` disposes the scope after its listeners.                  |
| `scenes()`, `sceneScope(scene)`      | Any thread: most recently activated first; null once disconnected.                                                                                        |
| `subscribe(event, listener, scope?)` | A `Resource`; the listener runs on the main thread until closed or `scope` ends.                                                                          |
| `presentIn<T>(…)` (`presentation.h`) | An `Operation<T>` on the main thread, settled by a result, the signal, the scope or the scene leaving (`sceneGoneError()`); no scene is `noSceneError()`. |
| Lucent API                           | `onAppEvent`, `onSceneEvent` (`lucent:ios`); `onActivityEvent` (`lucent:android`: `created` to `destroyed`, `newIntent`).                                 |

`delegate_events.h` holds what only the app delegate or a scene delegate
receives, which `LucentAppDelegate` (`platform/ios_app_delegate.mm`)
reports.

| Member                            | Contract                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DelegateEvent<P, A>(keep)`       | Listeners in subscription order, on the main thread; `report(p)` gives their answers, a throw's left out.                                                                                                                                                                                                                 |
| `keep`                            | A report with no subscriber waits for the first one, which hears it on the main thread: a URL, activity, shortcut, push token or relaunch reason.                                                                                                                                                                         |
| `mergeFetchResults`, `anyHandled` | Expo's merge: new data if any, else failed if any, else no data; handled if any handled.                                                                                                                                                                                                                                  |
| `FetchAnswers`                    | Each `reply()` answers once; `done` runs once, when all answered after `close()`, or at `expire()` with what came.                                                                                                                                                                                                        |
| Lucent API                        | `onAppEvent` from `lucent:ios` with `openURL`, `userActivity`, `shortcutItem`, `pushToken`, `pushTokenFailed`, `remoteNotification`, `backgroundFetch`, `backgroundURLSession`, `supportedInterfaceOrientations`, `relaunched`; `willPresentNotification` and `notificationResponse` from Lucent's notification delegate. |

### Planned

- [T104](../tasks.md#t104): `setTimeout`, `setInterval` and
  `queueMicrotask` on the calling context, cleared at teardown as
  `onDestroy` hooks run.
- [T110](../tasks.md#t110): apps' delegates call `LucentAppDelegate`, an
  Expo subscriber or `lucent init`'s lines. Android's back,
  configuration, new intent and user-leave events come through androidx's
  listeners where module code can reach them, and the subscriber covers
  the rest
  ([decision 0076](../decisions/0076-an-app-delegate-and-activity-subscriber.md)).
- [T130](../tasks.md#t130): a native root. Actors start with no `Host`, a
  later `Host` sees the same module state, and generated C entry points
  run module functions, once a decision says when module state resets.
- [T134](../tasks.md#t134): a `Host` per worklet runtime.

## C-BIGINT: the runtime's BigInt

**Version: v1.1.** `lucent/bigint.h` implements JavaScript's `BigInt` for
generated code and native integer conversions.

| Part         | Contract                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Value        | Immutable: an inline `int64` when it fits (canonical, no allocation), else shared 32-bit limbs. Beyond 2^30 bits (V8's limit): `RangeError`.                                                           |
| Construction | `BigInt()`, an explicit integral constructor, `fromInt64`, `fromUint64`, `fromDouble` (integral or `RangeError`), `parse` (`SyntaxError`), `fromDigits`, `LUCENT_BIGINT("…")`.                         |
| Operators    | `+ - * / % & \| ^ << >>`, compound forms, `pow`, unary `-` and `~`. Division truncates, `%` takes the dividend's sign, `/ 0n` is a `RangeError`, `>>` floors. `unsignedShiftRight` throws `TypeError`. |
| Comparison   | `==`, `<=>`, `compare(BigInt, double)` (NaN unordered), `strictEquals`, `isZero`, `sign`.                                                                                                              |
| Conversion   | `toString(radix)`, `toDouble` (ties to even), `toInt64` and `toUint64` (exact or `RangeError`), `wrapToInt64`, `wrapToUint64`, `tryInt64`, `tryUint64`, `asIntN`, `asUintN`.                           |
| Sharing      | `hash()` and `std::hash` hash equal values equal. `Transport` shares the value. `Convert<BigInt>` uses 64-bit `jsi::BigInt` forms when it fits, digits beyond.                                         |

`toNativeInteger<I>(value, what)` gives the bigint as native integer type
`I`, exactly, or throws `RangeError`
`<what>: <v> is out of range for a N-bit signed/unsigned integer`
(`detail::throwOutOfNativeRange`). `what` names a parameter of a member,
a field, a property or a result; Android says `arg0`, having no parameter
names. Glue reads a native integer as
`lucent::BigInt{v}`, braced, since a parenthesized one in a statement
expression parses as a declaration. iOS glue has `OutSlot::integer`,
`outBigInt`, `setOut(NativeRef, BigInt)` and `NumberOut<T>`; Android glue
has `toLongArray`, `fromLongArray` and `unboxLong`.

**Planned:** [T100](../tasks.md#t100) reads and writes `BigInt64Array` and
`BigUint64Array` elements as bigints.

## C-BUFFER: native buffers

**Version: v1.7.** How bytes cross without a copy, every exception to
the copy rule, and the native memory an object reports to JavaScript's
collector. v1.5 added the platforms' handle makers and memory pressure
([T107](../tasks.md#t107)), v1.6 read-only buffers and the frames
adopted as them ([T108](../tasks.md#t108)), and v1.7 every typed array
kind on `Uint8Array`'s paths, `DataView`, and borrows of a buffer as
typed elements ([T100](../tasks.md#t100),
[0099](../decisions/0099-a-buffer-is-borrowed-as-typed-elements-through-spans.md)).

**Implemented by** `lucent/buffer.h`, `handle.h`, `bytes.h`
(`ByteStorage`), `jsi/convert.h` and `convert.cpp` (`Borrowed`, the JS
handles), `jsi/host.cpp` (memory pressure), `platform/android.h`,
`ios.h` and `ios_pixels.h`, `compiler/lib/sdk/core.d.ts`, and the compiler's
`emit/buffers.ts`, `emit/lent-bytes.ts` and `emit/classes.ts`
(`NativeSized`).

### Invariants

- An ordinary typed array, `DataView` or `ArrayBuffer` copies both ways,
  as the kind it is: a `DataView` in a buffer of its own bytes.
- A `NativeBuffer`'s reference count keeps storage alive; access is a
  borrow.
- Borrows are synchronous and scoped, and cannot escape. A transfer with
  an active borrow fails, and after one every alias refuses use.
- JavaScript sees an opaque handle. No writable JavaScript `ArrayBuffer`
  aliases storage a worker mutates, or bytes no one may write.

### Runtime API

`NativeBuffer` is `Ref<NativeBufferObject>`; copies alias. Its control
block is one atomic word (state, write flag, reader count; 0 is open and
unborrowed), the storage, an atomic size, `Destroy` with its executor,
`generation` and `origin`.

| State          | Means                                                         |
| -------------- | ------------------------------------------------------------- |
| `Open`         | Holds storage; borrows and transfers may start.               |
| `Transferring` | A two-phase move to a task is in progress; access is refused. |
| `Transferred`  | Its storage moved; `size()` is 0.                             |
| `Closed`       | Its storage was released; `size()` is 0.                      |

| Member                                            | Contract                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `allocate(size, origin?)`                         | Zeroed bytes; `RangeError` on a bad size.                                                   |
| `adopt(data, size, destroy, destroyOn?, origin?)` | Takes native bytes; `destroy` runs on `destroyOn`, which must outlive the buffer.           |
| `adoptReadOnly(…)`, `readOnly()`                  | As `adopt`, for bytes no one may write: a write borrow and `transferToArrayBuffer` throw.   |
| `fromBytes(bytes)`, `toBytes()`                   | One counted copy each; `toBytes` under a read borrow.                                       |
| `withRead(f)`, `withWrite(f)`                     | `f` gets a `std::span` of the bytes. The free forms lend a `ByteSpan` or `MutableByteSpan`. |
| `withReadAs<K>(b, f)`, `withWriteAs<K>(b, f)`     | Free forms lending `TypedSpan<K>` or `MutableTypedSpan<K>`; `RangeError` unless whole `K`s. |
| `close()`                                         | True once; false if closed or transferred; throws while borrowed.                           |
| `transfer()`                                      | Moves storage to a new handle, one generation on.                                           |
| `transferToArrayBuffer()`                         | Moves storage and its release into an `ArrayBuffer`; counted as a transfer.                 |
| `handle()`                                        | A `NativeHandle` of the address, holding a read borrow until released; empty: `RangeError`. |
| `stats()`                                         | `allocated`, `adopted`, `released`, `transfers`, `copies`, `bytesCopied`.                   |
| `copyOut`, `copyIn`                               | Counted copies for callers that cannot be lent storage.                                     |

| Policy    | Contract                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrows   | One synchronous call. Reads share; a write excludes every borrow. A conflict throws `InvalidStateError` at once, never waiting.                                 |
| Errors    | `InvalidStateError` "NativeBuffer[ (origin)] is closed", "was transferred", "is borrowed" or "is being transferred"; `RangeError` for a size.                   |
| Release   | Once: at `close()`, in place, its error reaching the caller; or at the last reference, through `detail::runOn(destroyOn)`, reported.                            |
| Transfer  | Needs an open, unborrowed buffer. Every alias becomes `Transferred`; `close()` on one returns false, safe for `using`.                                          |
| To a task | Moves at copy time, commits once the whole input is copied, rolls back on failure. A refused or cancelled task releases it on its executor. Results move back.  |
| Spans     | `ByteSpan` reads like a `Uint8Array`: undefined out of range. `MutableByteSpan` writes wrap to 0–255; out of range, nothing happens. A `TypedSpan<K>` is `K`'s. |

### Exceptions to the copy rule

| Exception            | Rule                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Returned bytes move  | A returned `ArrayBuffer`, or whole-buffer typed array, that nothing else holds gives JavaScript the same bytes, adopted ones included, with their size as external memory pressure.                                                                                                                  |
| Lent arguments       | `Convert<ArrayBuffer>::borrow` and `Convert<TypedArray<K>>::borrow` give a `Borrowed<T>` over JavaScript's bytes (`ByteStorage::lend`) for a synchronous export that only reads them (`emit/lent-bytes.ts`). When it goes, storage anything still holds is copied (`keep()`). Loans are not counted. |
| Android `ByteBuffer` | `jni::adoptByteBuffer` (`adoptByteBuffer` in `lucent:android`) adopts a direct buffer's capacity under a global reference. Heap or read-only buffers throw `TypeError`. Java must leave it alone after.                                                                                              |
| Frames               | `objc::adoptPixelBuffer` and `jni::adoptHardwareBuffer` (`lucent:ios`, `lucent:android`) adopt one plane, retained or acquired and locked for the CPU until released: read-only (`adoptReadOnly`) for `"read"`, writable for `"readwrite"`. An `NSData` stays a copy (0086).                         |
| `ArrayBuffer` move   | `transferToArrayBuffer()` hands the storage, `Destroy` and executor to adopted `ByteStorage`, released with the last Lucent or JavaScript holder.                                                                                                                                                    |
| Native handles       | A `NativeHandle` gives other native code the address: a buffer's `handle()`; `objc::retainedHandle` (`retainedHandle` in `lucent:ios`), an object retained +1 and released once; `jni::byteBufferHandle` and `jni::hardwareBufferHandle` (`handleOf` in `lucent:android`).                           |

A loan is safe because JavaScript cannot detach a buffer while the call
runs: Hermes has no `ArrayBuffer.prototype.transfer`, and JSI no detach.

### Native handles and JavaScript

| Part              | Contract                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NativeHandle`    | `make(pointer, release, kind)`: a non-null pointer, `kind` naming it in errors. `pointer()` is 0 once released. `release()` is idempotent from any thread; its error reaches the caller. An unreleased handle goes with its last reference, which a debug build counts (`releasedOpen`).                                                        |
| Platform makers   | `byteBufferHandle`: a direct `ByteBuffer`'s address under a global reference; a heap one is `TypeError`. `hardwareBufferHandle`: the `AHardwareBuffer`, acquired; before API 26, `TypeError`. `retainedHandle`: the object, `__bridge_retained`, released with `CFRelease`; nil is `TypeError`.                                                 |
| Memory pressure   | `Object::lucentNativeSize_()`, 0 by default: an open `NativeBuffer`'s size, or a `NativeSized` class's `nativeSize` read under its module's lock. The host sets the change since its last report as external memory when the object crosses, and after a JavaScript call to its methods or setters. Past `UINT32_MAX`, it reports `UINT32_MAX`. |
| JS `NativeBuffer` | `lucent:NativeBuffer`, the same object while JavaScript holds it: `byteLength`, `toUint8Array`, `withRead`, `withWrite`, `withReadAs`, `withWriteAs`, `transfer`, `transferToArrayBuffer`, `handle`, `close`, `Symbol.dispose`. Borrows lend a counted copy; `withWrite` copies back even if the callback throws.                               |
| JS `NativeHandle` | `lucent:NativeHandle`: `pointer` (a bigint), `released`, `release()`. Spans never cross (LUCENT2006).                                                                                                                                                                                                                                           |
| `lucent:core`     | Its `NativeBufferStats` leaves out `released`, which garbage collection makes uncountable. Its JavaScript reference has the same states, errors, messages and counters.                                                                                                                                                                         |
| Borrow checks     | A borrow's callback is a function literal or named function (LUCENT1007), neither async nor a generator, and its span does not escape (both LUCENT3030).                                                                                                                                                                                        |
| Move checks       | A move is `x.transfer()`, `x.transferToArrayBuffer()` or `compute(task, x \| {x} \| [x])`. A later use of `x` in the block, once the move certainly ran, is LUCENT3031. The runtime refuses the rest.                                                                                                                                           |

## C-VIEW: components and views

**Version: v3.0.** `VIEW_CONTRACT_VERSION` in the code is 3: it counts
layout changes of `ComponentDescription` that consumers must follow, not
every revision. Views are in preview; [views.md](views.md) describes their
runtime.

**Implemented by** `packages/compiler/src/ui/` (`contract.ts`,
`identity.ts`, `describe.ts`, `merge.ts`, `roots.ts`, `toolkits.ts`,
`slot.ts`, `transport.ts`, `fabric.ts`), `emit/views.ts` and
`emit/setups.ts`, `lucent/reactive.h` and `view.h`, the hosts in
`runtime/cpp/rn/`, and the proxy in `runtime/js/views.js`.

### Invariants

- A component's identity is `<package>/<module path>#<export>`, never a
  basename.
- Props arrive as immutable whole-commit transactions, in which missing,
  `null` and unchanged values are distinct.
- JavaScript callbacks are event slots and routes, never JSI functions in
  Fabric props.
- Void commands are enqueued to the UI owner; others answer promises by
  request id. Every event, answer and measurement validates the full
  mount token, set at the committed mount.
- Setup runs once per mount, never in speculative render, and no view
  work runs under an actor's lock.

### Components and identity

- A component is an exported function of a `.lucent.tsx` module whose
  returns, in the target's code, derive from a root view (`ROOT_VIEWS`)
  or are a toolkit body. It is described, never emitted as a function,
  proxy export or JSI value.
- Identity takes the package name and the module's path under
  `lucent.sources` (for an app, the nearest `package.json` `name` and the
  relative path), without platform suffix or extension.
- `registrationName(id)` is `Lucent<export>_<hash>`, the hash being the
  first 12 hex digits of `sha256(id)`. `artifactName` is
  `<registration>ComponentView` on iOS and
  `dev.lucent.generated.<registration>Manager` on Android.
- Diagnostics: LUCENT3020 to LUCENT3025 (ComponentExport,
  ComponentContract, ComponentMainThread, ComponentPlatforms, ToolkitBody,
  NativeViewJsx).

### Component description

```ts
export type ViewType =
  | { readonly k: "number" }
  | { readonly k: "boolean" }
  | { readonly k: "string" }
  | { readonly k: "enum"; readonly values: readonly string[] } // sorted
  | { readonly k: "array"; readonly element: ViewType }
  | { readonly k: "object"; readonly fields: readonly ViewField[] }
  | { readonly k: "nullable"; readonly inner: ViewType }
  // A prop's only: an instance of an exported class, `class` its id (`<module>.<name>`)
  | {
      readonly k: "instance";
      readonly class: string;
      readonly name: string;
      readonly module: string;
    };

export interface ComponentDescription {
  readonly id: string;
  readonly package: string;
  readonly module: string;
  readonly export: string;
  readonly jsModule: string; // the Lucent module whose JavaScript exports it
  readonly registration: string;
  readonly props: readonly ViewField[];
  readonly events: readonly EventDescription[];
  readonly commands: readonly CommandDescription[];
  readonly children?: { readonly optional: boolean }; // none: takes no children
  readonly platforms: Partial<Record<Platform, PlatformBinding>>;
  readonly source: { readonly file: string; readonly line: number; readonly column: number }; // messages only
}
export const VIEW_CONTRACT_VERSION = 3;
```

| Type (all fields `readonly`) | Fields                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ViewField`                  | `name`, `type: ViewType`, `optional` (missing, `null` and unchanged stay distinct)                        |
| `EventDescription`           | `name`, `slot`, `optional`, `params: ViewField[]`, `delivery: EventDelivery`                              |
| `EventDelivery`              | `"discrete"`, `"continuous"` or `"coalesced"`                                                             |
| `CommandDescription`         | `name`, `params: ViewField[]`, `result`: `{ kind: "enqueue" }` or `{ kind: "request"; value?: ViewType }` |
| `PlatformBinding`            | `root: { module, name }` (the platform class it returns), `artifact`                                      |

### Props, events and commands

| Part      | Contract                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props     | The props parameter's properties, in order, plain data only; `optional` is `?` or `undefined`. `key`, `ref`, `style` and `children` (but as `Children`) are reserved.                                   |
| Instances | A prop may be an instance of an exported, non-generic class, alone, `T \| null` or in an array. A view's use of a member that code off the main thread uses too, one of them writing it, is LUCENT3022. |
| Refused   | With the path: bigint, library objects (`Date`, `Map`, `Set`, `Uint8Array`), other class instances, tuples, mixed unions, index signatures, recursive types, nested functions, destructured props.      |
| Events    | Callback props named `on[A-Z]…` returning nothing; the slot is the index among events. A direct call posts `{ args: [...] }` without trailing omitted arguments. An alias of the prop is unknown code.  |
| Order     | A view's events arrive in the order sent; a coalesced one replaces the latest waiting event of its type. Events and answers have no mutual order.                                                       |
| Commands  | One `expose({...})` at setup's top level. A `void` result is `enqueue`; `T` or `Promise<T>` is `request`, with arguments `[id, …]`.                                                                     |
| Agreement | Setup and all it exposes pass `check(unit, "main")`. Props, events and commands agree across targets and with a split module's declaration (LUCENT3023).                                                |

| Delivery             | Prop type                    | React Native                     |
| -------------------- | ---------------------------- | -------------------------------- |
| `discrete` (default) | `(v: T) => void`             | `RawEvent::Category::Discrete`   |
| `continuous`         | `Continuous<(v: T) => void>` | `RawEvent::Category::Continuous` |
| `coalesced`          | `Coalesced<(v: T) => void>`  | `dispatchUniqueEvent`            |

### Transport

| What            | Contract                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keys            | Prop at `index`: `p<index>`. Handler in `slot`: `e<slot>`, true while JavaScript listens. Event: `lucent<slot>`, registered as `topLucent<slot>`.                                                                                                                                                                                    |
| Nullable values | Boxed, `[value]` or `[null]`: React sends a removed prop as null, and undefined as null inside objects.                                                                                                                                                                                                                              |
| Instances       | `__lucentViewInstance(value)` (`kInstanceName`) gives an instance's id: its runtime's id × 2^32 plus its number there, the same while it lives. The proxy checks the class's prototype first (a `TypeError` at render). Props hold the instance from their parse; an id of a gone instance or a torn-down runtime reads as missing.  |
| C++ values      | Keep presence and nullness; `changed()` treats `Object.is` or deep equality as unchanged.                                                                                                                                                                                                                                            |
| Requests        | `__lucentViewRequests(settle)` (`kRequestsName`), settled `settle(id, error \| null, value)` on the JS thread. A runtime's ids start at `requestBase(id)`, its id × 2^32. JavaScript rejects pending requests at unmount and ignores late answers.                                                                                   |
| Generated files | `cpp/generated/<target>/views/<registration>.{h,cpp}`, `<registration>_mount.cpp`, `views/lucent_views.{h,cpp}`, in `lucent::views::<registration>`.                                                                                                                                                                                 |
| React surface   | Own props, callbacks, React Native's `ViewProps` and a `ref` to the commands, typed in `types/views/<module>.d.ts`, an instance's class from `lucent:module/<module>` (`types/module/<module>.d.ts`, `instanceModules`). `lucent:views/<module>` resolves to `js/_lucent/components/<module>.js` (`CompileResult.componentModules`). |
| API hash        | Covers component contracts (C-BUILD).                                                                                                                                                                                                                                                                                                |

### Mount and hosts

```cpp
using Event = std::variant<Event0, …>;  // std::variant<std::monostate> without events
using Emit = std::function<void(const Event&)>;
struct Mount {
  static std::shared_ptr<Mount> create(const Props&, Emit /*, lucent::NativeRef slot */);  // main thread
  lucent::NativeRef view() const;                          // empty if setup threw
  void update(const Props& props, const Props& previous);  // any thread; one transaction on main
  void setEmit(Emit);                                      // main thread
  void command(const Command&, lucent::views::Respond);    // main thread; with commands only
  void dispose();                                          // main thread; idempotent
};
```

| Step or rule  | Contract                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token         | `MountToken { tag, generation }`; `nextGeneration()` is process-unique and never 0.                                                                                         |
| Create        | At the committed mount. Android creates at attach, or at the first command.                                                                                                 |
| Update        | Per commit, never re-running setup.                                                                                                                                         |
| Command       | Parsed by the host. One that does not parse, or reaches a view without a mount, is rejected at once.                                                                        |
| Dispose       | At unmount or recycle: closes the prop inbox, disposes the mount's scope, clears routes, releases the view, rejects owed requests.                                          |
| Answers       | Once per request: a result, an error, or "`<Export>` unmounted before answering". `answerTo(host, requester)` drops one the view no longer holds. Work is not cancelled.    |
| Threads       | Every host entry enters the main context (`ContextEntry`).                                                                                                                  |
| JS ref errors | `InvalidStateError` for a command while not mounted, `AbortError` for a request pending at unmount, `Error` otherwise.                                                      |
| iOS           | `LucentComponentView` and a generated `<registration>ComponentView.mm`: `view()`, `controller()`, `update`, `command`.                                                      |
| Android       | `LucentViewManager`s listed by `LucentViewManagers`, `LucentHostView` shells, `views/<registration>_android.cpp`, `views/lucent_hosts.cpp`; emitters by `(surfaceId, tag)`. |

### Setup, sizing, children and bodies

| Part              | Contract                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup             | `<X>_setup` with `<X>_Props` and `<X>_Commands`, using `lucent:ui`: `signal`, `effect`, `expose`, `onDispose`, `bind`, `slot`, `invalidateSize`, `Children`, `Continuous`, `Coalesced`.                                                                                                            |
| Reactive graph    | `ui::mainGraph()` (`reactive.h`) runs on its owner only. Signals notify by `Object.is`; computed values are lazy; an effect's last run is disposed before it reruns; one past `loopLimit` runs is reported.                                                                                        |
| Content           | `Content` (`view.h`) hears every entry into a mount, functions setup made included (`inContent`). Code after an `await` calls `invalidateSize()`.                                                                                                                                                  |
| Sizing            | Without children or a fixed size, a component is a measurable Yoga leaf. The host posts `{ size, constraints, revision }`; the renderer keeps one that answers today's constraints, is not older, and moves the size by at least one pixel (`1/scale` points). At most three unsettled are posted. |
| Children          | `children?: Children` makes a Yoga container (`SlotShadowNode`). Setup calls `slot<T>()` once. React Native owns each child, the host the slot and order, setup the slot's placement (`Placement { revision, insets, rtl, swapped }`).                                                             |
| Toolkit bodies    | The toolkit's JSX (`View`, `Composed`), returned once as the last statement of its platform's code; a shared file's JSX runtime is `lucent:jsx`. A toolkit name outside its platform's code is LUCENT3024.                                                                                         |
| JSX mapping       | SwiftUI: an element is an initializer, a label-named attribute an argument, other attributes modifiers in order. Compose: an element is a composable; children are the content lambda.                                                                                                             |
| Body slots        | Setup data a body reads is a value slot; a setup function it calls, an action slot; an array shown item by item, a keyed list slot. `bind(signal)` gives a view a scalar signal. Helpers become a Swift `View` or a `@Composable`.                                                                 |
| Platform-view JSX | A view class is a tag ([views.md](views.md#platform-views-as-jsx)), its attributes derived from its declarations under `"~jsx:<module>.<class>"`.                                                                                                                                                  |

### Planned

- [T122](../tasks.md#t122): an iOS root may be a `UIViewController`. [T123](../tasks.md#t123): toolkit
  bodies show lists of instances, and helpers take toolkit values,
  children and bindings. [T144](../tasks.md#t144): views on the web are a
  diagnostic.

## C-BUILD: build records and identities

**Version: v1.8.** What a build records about itself and requires of the
app afterward. `build`, `check`, `dev`, Metro and the native build hooks
run one pipeline, `buildProject`, never recursively.

**Implemented by** `packages/lucent/src/cli/` (`build-graph.ts`,
`pipeline.ts`, `sdk-usage.ts`, `commands/sdk-lock.ts`), bindgen's
`provider.ts`, the compiler's `emit/identity.ts` and `project-sdk.ts`,
`lucent/jsi/host.h`, and the loader `runtime/js/index.js`. JSON schemas
are `packages/lucent/schemas/`, copied to `apps/website/static/schemas/`.

### Build record

`.lucent/build-record.json` is written atomically on every return of
`buildProject`; the one it replaces stays as `build-record.previous.json`.

```ts
export const BUILD_RECORD_SCHEMA_VERSION = 1;
export type NodeKind =
  "resolve" | "extract" | "check" | "generate" | "native-build" | "install" | "reload";
export type NodeStatus = "ok" | "cached" | "failed" | "skipped";
export interface Artifact {
  key: string; // a project-relative path or a named key
  hash: string;
}
export interface BuildNode {
  id: string; // unique within a record
  kind: NodeKind;
  status: NodeStatus;
  inputs: Artifact[]; // sorted by key
  outputs: Artifact[]; // sorted by key
  hash: string; // sha256 of kind, inputs and outputs, 16 hex digits
  detail?: string;
  log?: string;
}
export type RequiredAction =
  | { kind: "none" }
  | { kind: "reload-js" }
  | { kind: "compile-native"; targets: string[]; changedUnits: string[] }
  | { kind: "relink"; targets: string[]; dependencyChanges: string[] };
export interface PendingAction {
  kind: ActionKind;
  targets: string[];
  files: string[];
}
export interface BuildRecord {
  schemaVersion: 1;
  mode: "build" | "check";
  nodes: BuildNode[];
  requiredAction: RequiredAction;
  pendingActions: PendingAction[];
  timings: Record<string, number>; // ms per node id; never hashed
  startedAt: Record<string, number>; // ms from the build's start; never hashed
}
```

| Node id              | Kind       | Records                                                                                                                                |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve`            | `resolve`  | `native-dependencies`, and a `packages/<package>/<path>` input per native path a `lucent.json` lists.                                  |
| `resolve:lock`       | `resolve`  | A `--frozen` build's lock problem.                                                                                                     |
| `resolve:android`    | `resolve`  | Android dependencies; `skipped` when Gradle resolves them.                                                                             |
| `resolve:platforms`  | `resolve`  | Targets the build cannot compile.                                                                                                      |
| `extract:extensions` | `extract`  | An `ext/<name>` input per extension, hashed on its header and source directories.                                                      |
| `extract`            | `extract`  | A `<platform>/<module>` input per SDK module, hashed on its artifacts, and an input per artifact id.                                   |
| `extract:lock`       | `extract`  | A frozen build's SDKs that differ from the lock.                                                                                       |
| `check`              | `check`    | Every project file the check read, by content (`missing` or `directory` where none was); outside files as one `outside-project` input. |
| `generate`           | `generate` | The native package's files, `resolved.json` included and `manifest.json` not.                                                          |

Equal inputs write equal nodes. `cached` is recorded for `REUSABLE_STEPS`
(`resolve:android`, `extract`, `check`, `generate`) whose inputs are
unchanged. `native-build`, `install` and `reload` are reserved.

| Action (strongest first) | When                                                                  | As `requiredAction`                    |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------- |
| `reinstall`              | The app's configuration changed (Info.plist, entitlements, manifest). | —                                      |
| `relink`                 | Native dependencies or build files changed.                           | Native files added or removed          |
| `compile-native`         | Native code changed.                                                  | Rebuilt native code, with its units    |
| `repackage`              | Resources or assets changed.                                          | —                                      |
| `reload-js`              | Only JavaScript proxies changed.                                      | Changed proxies only; otherwise `none` |

`pendingActions` lists every action needed; `build --json` reports them as
`actions`.

### Options, outcome, lock and usage

| Part           | Contract                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildOptions` | `mode`, `force`, `platforms`, `out`, `prefetch`, `signal` (a newer change aborts the build before it publishes), `frozen`, `session`.                                                                                                                                                                                                       |
| `BuildOutcome` | `ok`, `fatal`, `upToDate`, `files`, `modules`, `diagnostics`, `warnings`, `next`, `actions`, `superseded`, `nativeInputs`, `read`, `record`, `usage`, `skipped` (targets left out, and why), `ms`.                                                                                                                                          |
| Read lists     | `.lucent/check.json` and `manifest.json` list what a passing check read (`read`) and the links it followed (`realpaths`); the record does not.                                                                                                                                                                                              |
| Usage and lock | `.lucent/sdk-usage.json` and `lucent-sdk.lock.json` (committed beside `package.json`) hold C-BIND's `SdkUsage`, under `sdk-lock.schema.json`. A missing or unreadable usage file reruns the check.                                                                                                                                          |
| Xcode's phase  | `LUCENT_XCODE_BUILD=1`, from the podspec's `script_phase`: problems also print as Xcode issues (`file:line:col: error: CODE: message`), and a build fails when `podSourcesDigest` differs from the `.pod-install` digest the podspec wrote at pod install.                                                                                  |
| Pods to come   | `LUCENT_PREBUILD=1` (the Expo config plugin's build): while a Lucent package's pod is missing from `Podfile.lock`, iOS is skipped and deferred. `cocoapods/lucent.rb`'s `lucent_post_install` builds with `LUCENT_POD_INSTALL=1` once pods are installed, then lists the new sources in the `LucentNative` target and links new frameworks. |
| `--frozen`     | Fails unless every locked target has its SDK and the SDKs and symbols match the lock; takes nothing from earlier caches. `lucent sdk lock` writes the lock; `lucent sdk diff` follows `sdk-diff.schema.json`.                                                                                                                               |
| Schema set     | `lucent sdk lock --schemas` writes `lucent-sdk.schemas/<platform>/`: one `SchemaSetEntry` per file (`format` 1, `platform`, `module`, `kind`, `artifacts`, `entry?`, `schema` or `names`). Read through `SdkOptions.schemas` only where the platform's SDK is not installed.                                                                |

### Build identity

```ts
export interface BuildIdentity {
  runtimeAbi: number;
  reactNative?: string; // the React Native release by its minor ("0.86"); none outside an app
  programs: Record<string, string>; // target (ios, android, host, all) → hash of its generated files
  apis: Record<string, Record<string, string>>; // target → module → API hash
}
```

| Part          | Contract                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `programHash` | sha256 (16 hex digits) of the target's generated files, without `#line` directives and trace sites' positions.                                                                                                     |
| `apiSurface`  | What JavaScript sees of a module: exports, signatures, struct fields, class members and subclasses, interface implementations, component contracts. Interface ids keep only a file name.                           |
| `runtimeAbi`  | `RUNTIME_ABI` (2), equal to `kRuntimeAbi` in `jsi/host.h`, as `lucent_identity.cpp` static-asserts.                                                                                                                |
| `reactNative` | Added by the package writer. The TurboModule names its own (`setReactNativeBuild`).                                                                                                                                |
| Where         | Native code exposes `__lucentIdentity` (`{ host, runtimeAbi, target, program, modules }`). The expected identity is `js/_lucent/identity.js`, passed to `loadModule`, and in `manifest.json`; never in the record. |

The loader checks each module before loading it, once per host and
program. A thrown error has `code: "LUCENT_NATIVE_MISMATCH"` and an
`action`.

| Finding                                                 | Result                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No identity                                             | Throws, `compile-native`.                                                                                                 |
| Another runtime ABI or React Native release             | Throws: `reload-js` when native's is newer, else `compile-native`. The release is compared only when both sides name one. |
| The target's program missing from the expected identity | Throws, `compile-native`.                                                                                                 |
| A module missing, or its API different                  | Throws, `compile-native`.                                                                                                 |
| Only the program differs                                | One warning; the module loads.                                                                                            |

`identity.js` is left out of pending-action classification: it moves with
the native code, whose change already names the action.

### Planned

- [T111](../tasks.md#t111): the app's root `lucent.json` is merged like a
  package's and joins the `resolve` inputs.
- [T130](../tasks.md#t130): `lucent.json` `launch` names modules created
  at launch.
- [T133](../tasks.md#t133): an extension target is a second native build
  of the same program.
- [T144](../tasks.md#t144): the web resolves proxies to modules run as
  JavaScript, with no native identity to check.

## C-TRACE: correlated tracing

**Version: v1.** The runtime's tracing, and how the CLI lays it out beside
build phases.

**Implemented by** `lucent/trace.h` and `trace.cpp`, the bindings' entries
in `lucent/jsi/convert.h`, the compiler's `emit/trace-site.ts`, and
`packages/lucent/src/cli/commands/trace.ts` with `cli/trace.ts`.

| API (`lucent::trace`) | Contract                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types                 | `Category`, `categoryName`, `Site { name, file, line }`, `Event { phase, category, name, detail, startNs, durationNs, id, parent, value, count, thread, context, site }`. Strings are static. |
| Control               | `Options { capacity = 65536, platform = false }`; `enabled()` (one relaxed load), `start`, `stop`, `startFromEnvironment`.                                                                    |
| Output                | `events`, `dropped`, `chromeJson`, `writeChromeJson`; clocks `now`, `toNs`; `newId`.                                                                                                          |
| Recording             | `begin` and `end`, `span`, `instant`, `counter`, with an optional `Detail { id, parent, value, count, site, detail }`; `Scope`.                                                               |
| Correlation           | `currentId`, `Current`, `Correlate`, `takeCorrelation`.                                                                                                                                       |
| Macros                | `LUCENT_TRACE_SITE(name)`, `LUCENT_TRACE_SITE_AT(name, file, line)`, `LUCENT_TRACE_SCOPE(name)`.                                                                                              |
| Bindings              | `callSync(rt, host, actor, site, body)`, `callAsync(rt, host, actor, site, start)`, `settleLater(host, id, promise, traceId, site)`.                                                          |

| Category     | Names                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry`      | `<export>`, with its `.lucent.ts` site                                                                                                                                      |
| `lock`       | `lucent-lock`                                                                                                                                                               |
| `queue`      | `wait` (detail: an executor's label), `js.wait`; span `channel.wait` and instants `channel.dropped`, `channel.refused` (id: the channel; value: the count so far)           |
| `run`        | `run` (detail: an executor's label); `enter`, a callback entering a non-actor context at once                                                                               |
| counter      | `channel.depth`, a series per channel id                                                                                                                                    |
| `native`     | The `LUCENT_TRACE_SCOPE` name, with its site                                                                                                                                |
| `completion` | `<export>`                                                                                                                                                                  |
| `compute`    | Spans `compute.wait`, `compute.run`, `compute.deliver` (detail: the entry); instants `compute.saturated` (value: queue depth), `compute.rejected`; counter `compute.queued` |
| `copy`       | `transport.copy` (value: bytes, count: objects), `buffer.copy`                                                                                                              |
| `alloc`      | `buffer.allocate`, `buffer.adopt` (bytes)                                                                                                                                   |
| `build`      | `<node id>` from the build record (CLI)                                                                                                                                     |
| `effect`     | `effect`: a span per run of a view's effect, at its source line                                                                                                             |

| Policy      | Contract                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correlation | An async call's id covers its entry, its job's queue and run, `js.wait` and its completion. A post in a traced job names it as `parent`. Each compute task has its own id.                |
| Cost        | Off: one relaxed load per hook. On: a ring buffer under one mutex keeps the latest `capacity`; drops are counted as `otherData.dropped`.                                                  |
| Environment | `LUCENT_TRACE=1`, `platform` or `<file>.json` (written at exit), read when the module context starts; on Android also `debug.lucent.trace`.                                               |
| Mirror      | Opt-in os_signpost (subsystem `dev.lucent`, category `runtime`). On Android, ATrace async sections `category:name` (API 29, via `dlsym`) and counters, always, behind `ATrace_isEnabled`. |
| Sites       | Bindings name the export's declaration; native spans take `__FILE__` and `__LINE__` under the compiler's `#line`. Identities ignore positions.                                            |
| CLI         | `lucent trace` merges `.lucent/build-record.json` (`startedAt`, `timings`; untimed nodes are marks) with `--runtime` traces into `.lucent/trace.json` or `--out`.                         |

## C-EXT: typed native extensions

**Version: v1.** A Lucent package can wrap a C library, or a C interface
over C++, as a native extension. Lucent code imports its functions and
handles from `lucent:ext/<name>`, from shared code too: both platforms
build the C code into the one native package.

**Implemented by** `compiler/src/package-schema.ts`
(`ExtensionDeclaration`), `bindgen/src/c-header.ts` (`extractCHeader`,
`cLinkage`, `findClang`), `compiler/src/extensions/bind.ts` and `dts.ts`,
`compiler/src/emit/extensions.ts`, and `lucent/extension.h`.

| Field (`lucent.json` `extensions.<name>`) | Meaning                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `header`                                  | Relative to the package, in a directory both `ios.nativeSources` and `android.nativeSources` list.                 |
| `handles.<CType>`                         | `create` (a pointer, null on failure), `destroy` (`void f(T *)`), `methods` (taking the handle first), `affinity`. |
| `functions.<f>`                           | `params`, `failsWhen`, `affinity`, `blocking` (a main-thread call warns).                                          |
| `params.<p>`                              | `{ bytes: "read" \| "write", length }`, `{ string: "utf8" }` or `{ error: "<Struct>" }`.                           |
| `errors.<Struct>`                         | `code` (an integer field), `message` (a `const char *` field), `release` (`void f(E *)`).                          |
| `affinity`                                | `any` (the default: any thread, one call at a time) or `main`.                                                     |
| `failsWhen`                               | `null`, `negative`, `nonzero`, `zero` or `false`.                                                                  |

| Rule       | Contract                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header     | Compiles as C and C++, `extern "C"` for C++. Read with `$LUCENT_CLANG`, else `clang` on the `PATH`, Xcode's, or the newest NDK's. `long` and `size_t` are 64 bits.                                             |
| Checks     | Every name and shape is checked against the header; a mismatch fails the build with `<package>/lucent.json: extensions.<name>.<field>: <reason>`.                                                              |
| Handles    | An opaque struct. `close()`, `[Symbol.dispose]()` or its last reference destroys it once; then use throws `InvalidStateError`. A call holds its handles. Handles never cross to JavaScript (LUCENT2006).       |
| Parameters | Bytes (a `Uint8Array`, its length given), a UTF-8 string (`TypeError` on NUL), or the error struct. Nothing escapes the call.                                                                                  |
| Integers   | Wider than 32 bits: exact bigints. Others: numbers under WebIDL's `[EnforceRange]`. Floats round as `Math.fround`.                                                                                             |
| Failure    | Throws an `Error` with the struct's message (copied at once) and code, else `<f> failed`. `nonzero` and `false` results are statuses. An `error` parameter needs `failsWhen`; `release` runs after every call. |
| Exceptions | One escaping a C function ends the process (`ext::call` is `noexcept`). Conversion errors throw before the call.                                                                                               |
| Binding    | A function needing no declaration binds as it is; one taking a handle must be named. Function pointers, variadics and structs by value are listed as skipped, or fail when named.                              |
| Outputs    | `.lucent/native/types/ext/<name>.d.ts`; each extension in `resolved.json`; the `extract:extensions` node.                                                                                                      |
| Runtime    | `Handle::open(what, pointer, destroy, destroyOn?)`, `use<T>()` for one call, idempotent `close()`, shared state (`identity()`); `ext::integer`, `real`, `data`, `length`, `utf8`, `number`, `bigint`.          |

**Planned:** [T142](../tasks.md#t142) reads C++ headers: a class is a
handle, `std::string` a string, `std::vector` an array, `std::optional` an
optional, and templates and inheritance are refused. A generated wrapper
catches C++ exceptions into the error struct. Functions take callbacks on
a stated context and an `AbortSignal` as a flag. `android.prefab` links
Gradle prefab modules.

## Accepted decisions these contracts assume

Swift value types cross as boxed references. Kotlin extension functions
take the receiver first. Android callbacks use one reflection-based
`NativeProxy`. Packages ship sources only, and an app has one runtime.
Events are void; commands are a void enqueue or a promise result. SwiftUI
and Compose views are the toolkit's JSX. A view prop may be an exported
class's instance
([0075](../decisions/0075-instances-of-exported-classes-as-view-props.md),
[0098](../decisions/0098-an-instance-prop-is-held-from-its-commit-and-checked-by-member.md)).

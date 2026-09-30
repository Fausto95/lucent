# Full SDK plan: status

Tracks `lucent-full-sdk-plan.md` (Parts 0–5 on `full-sdk`): the Swift-only
and Kotlin-only APIs, the remaining type shapes, and the docs. Updated in the
same commit as the work it describes.

Decisions on the plan's open questions (2026-09-24): Swift value types cross
as boxed references only; Kotlin extension functions are plain functions
(receiver first), never methods; Swift shims need no Xcode or Swift beyond
what React Native requires. The Kotlin metadata reader (TypeScript or a JVM
tool) waits for its spike.

## Coverage

Unrepresentable members, from `lucent sdk coverage` (the bare example app, so
its Gradle dependencies count). Swift-only members are counted from Part 0 on;
before that they were left out, and CryptoKit read 0 of 0.

| Module           | 2026-09-24 baseline  | Swift-only counted     | After Part 1 (Swift-only aside)             | After Part 2           |
| ---------------- | -------------------- | ---------------------- | ------------------------------------------- | ---------------------- |
| UIKit            | 181 of 6,046 (3.0%)  | 2,214 of 8,079 (27.4%) | 2,175 of 8,030 (27.1%); 142 of 5,997 (2.4%) | 941 of 8,117 (11.6%)   |
| Foundation       | 431 of 3,899 (11.1%) | 5,608 of 9,076 (61.8%) | 5,417 of 8,986 (60.3%); 240 of 3,809 (6.3%) | 3,090 of 9,520 (32.5%) |
| AVFoundation     | 65 of 3,512 (1.9%)   | 671 of 4,118 (16.3%)   | 654 of 4,096 (16.0%); 48 of 3,490 (1.4%)    | 276 of 4,089 (6.7%)    |
| StoreKit         | 0 of 229 (0.0%)      | 653 of 882 (74.0%)     | unchanged                                   | 186 of 882 (21.1%)     |
| CryptoKit        | 0 of 0               | 529 of 529 (100%)      | unchanged                                   | 143 of 588 (24.3%)     |
| android.\*       | 207 of 79,178 (0.3%) | unchanged              | 40 of 79,187 (0.1%)                         | unchanged              |
| androidx.core.\* | 29 of 4,544 (0.6%)   | unchanged              | 10 of 4,544 (0.2%)                          | unchanged              |
| gms.location     | not measured         | not measured           | 0 of 526 (0.0%)                             | unchanged              |

Totals move a little between columns: members Swift synthesizes from a
protocol conformance, and protocols' promise forms, no longer count.
`androidx.datastore` is not measured yet; its port (Part 3) adds it.

## Part 0: docs match the code

- [x] `lucent sdk coverage` counts Swift-only members (reason "Swift-only");
      CI's baseline covers StoreKit and CryptoKit too.
- [x] Audit of every works / not-yet claim in README, ROADMAP M2,
      platform-bindings.md and the website against the code. The plan's
      examples were already fixed by the docs rewrite (the README has no
      "hand-written UIKit subset", ROADMAP marks delegates and packages done).
      Fixed: NSNumber (an object, not a number), the haptics port's path,
      "Android generics" (generic methods work; generic classes' own type
      parameters don't), the main-thread rule (blocks and requirements the
      SDK calls on main count too), cache and prefetch details, and missing
      limits (ObjCBool, Error to Objective-C, nested collections, char and
      object results in Java callbacks).
- [x] Tests for the documented limits, which had none: Android arrays,
      Java field writes, SDK methods as values; iOS subclassing, NSNumber.
- [x] Fixed on the way: a Java array result other than byte/int/long/String
      crashed the compiler; it is LUCENT2002 now.
- [x] ROADMAP M2 lists this plan's parts as the remaining items.

Claims checked but not covered by an automated test (device runs or
timings): a Java exception's `code` (the SDK tab's probe case), the
per-module extraction lock, `$LUCENT_ANDROID_JARS`, the extraction timings
("a few hundred ms", "about 40 s"), and the class-loader fallback.

## Part 1: remaining shapes without shims

- [x] Android generic classes: type parameters, type arguments on references
      and supertypes, values of a type parameter at calls and in proxies
      (android.\* 207 → 40 unrepresentable; no member renamed).
- [x] `await` on Task, ListenableFuture and CompletionStage (and subclasses),
      through a NativeProxy listener, settled on the Lucent thread. Retired
      before release: it named the classes in a table;
      `await` on a native object is now LUCENT1010, and `fromCallback`
      adapts the listener.
- [x] Location port: `getCurrentPositionAsync` reads fused location's Task
      through `fromCallback` (play-services-location in the bare app; Expo
      gets it via expo-location).
- [x] `using` declarations in the language (e2e case), `Symbol.dispose` on
      Lucent classes (SuppressedError in the runtime; `await using` and
      `using` directly in a case clause rejected). Fixed on the way:
      constructor bodies reading parameter properties' parameters.
- [x] `AutoCloseable` / `Closeable` → `Symbol.dispose` (a `using` cursor
      test: `probe.usingCursor()` in the SDK tab, awaiting device runs).
- [x] Constant groups: annotation types holding constants (gms `Priority`)
      → enums; `@IntDef` / `@StringDef` (SDK and AAR `annotations.zip`) type
      results as unions of the constants; arguments outside a group warn
      (LUCENT3008, the first warning; decided with the user instead of
      narrowing parameters).
- [x] `@MainThread` / `@UiThread` → main-only (LUCENT3006), class-level
      included, `@AnyThread` exempting a member; `@WorkerThread` warns in a
      main context (LUCENT3009). Declarations document both per member.
- [x] Objective-C generic classes (`NSCache<K, V>`, `NSHashTable`,
      `NSMapTable`, `NSLayoutAnchor<AnchorType>`): type parameters, arguments
      on references, values converted as the type argument says.
      `NSMeasurement`'s remaining skips are Swift's `Measurement` struct (Part 2).
- [x] Blocks taking blocks or CoreFoundation values: blocks the platform
      passes (completion handlers, in calls and in protocol requirements a
      Lucent class implements) become Lucent functions; CF values keep their
      C types in block signatures. Protocols declare requirements in their
      completion-handler form only (the promise overload made them
      unimplementable).
- [x] Remaining pointer out-parameters, one test per shape: numbers, enums
      and BOOLs (`NumberOut`), C structs (`StructOut`, inout), objects,
      strings and dates (`ObjectOut`), all through `Out<T>` with a writable
      `value`. `BOOL *` (ObjCBool, 61 members: `stop` in enumeration
      blocks) in calls, and in blocks and protocol methods that run while
      the platform waits, as an Out written back. Left: struct and object
      pointers a block or protocol method receives (6), and buffers
      (`UnsafePointer<UInt8>`, a rule of their own).
- [x] Coverage after Part 1 (Foundation, android.\*, gms.location): see
      the table. What is left in UIKit and Foundation besides Swift-only
      members: Selector, AnyClass, buffers, raw pointers, protocol
      compositions.
- [ ] Follow-up found on the way: option sets (`NS_OPTIONS`) have no zero
      member, so "no options" (`0`) does not type-check.
- [x] Suites: typecheck, test (432), runtime (315 checks; ASan+UBSan and
      TSan clean), e2e (23), bench --check, app-check ×2, smoke-install,
      glue compile (iOS SDK and NDK, -Werror).
- [x] Devices: SDK tab, bare and Expo, iOS simulator and Android emulator
      (Release): bare 24/24 on both, Expo 37/37 on both; awaited location
      and the `using` cursor pass. The Expo Android run found that R8
      renamed classes only named in descriptors (CancellationToken), fixed
      by keeping them.

## Issues fixed on this branch

- [x] #11: a struct with an SDK-object field (JSON writer for NativeRef;
      the struct leaking into the other platform's header).
- [x] #12: early-return platform guards (`if (PLATFORM === "ios") return …`).

## Codegen package (before the rest of Part 1)

Decided 2026-09-24: a private `packages/codegen` with a full AST per
language and a printer each, replacing string templates in every emitter,
done now so the rest of the plan generates code through it.

- [x] Corpus: a script that snapshots every generated file (e2e cases,
      both example apps for iOS, Android and host) and compares against it,
      C++ normalized with clang-format.
- [x] Package scaffold (private, bundled into @lucent-lang/lucent).
- [x] C++ AST and printer, Objective-C++ forms included, with unit tests.
- [x] Migrate the declaration-level C++: literals, headers and structs,
      JSON writers, classes, interfaces, bindings, delegates.
- [x] Migrate statements (function.ts).
- [x] Migrate expressions: function.ts, builtins.ts, native.ts,
      awaitables.ts, integers.ts (E.c becomes an expression node).
- [x] Java AST: generated SDK subclasses (java.ts).
- [x] TypeScript AST: SDK declarations (dts.ts), stubs, JS proxies
      (declaration text changed, parse trees identical).
- [x] Generated build pieces in native-package.ts: the manifest as XML;
      the one-line Gradle, podspec and keep-rule edits of the templates
      stay line edits (decided: no Groovy/Ruby/ProGuard trees).
- [x] No string-built C++ left in the emitters; the migration's `raw`
      nodes, `cppText` and the text literal helpers removed (corpus
      byte-identical).
- [x] No string-template code left in the Java and TypeScript emitters.
- [ ] Swift and Kotlin ASTs: added with Parts 2 and 3, their first users.

## Part 2: Swift shims

- [x] Swift-only types and members from symbol graphs (`s:`) into the
      schema (a `swift` field: Swift name, async/throws/mutating; payload
      enums' cases; `some P` for standard protocols; `bytes` for
      ContiguousBytes), declared in the SDK `.d.ts`; calls report
      LUCENT1001 until the shims land. Members naming undeclared types are
      skipped. `.swiftinterface` fallback: not needed so far.
- [ ] Follow-up: the generated `.d.ts` carry ~400 pre-existing errors that
      `skipLibCheck` hides (interface merging of protocols, statics of
      Objective-C generics).
- [x] `@_cdecl` shim generation (LucentShims.swift, declared in the glue
      that calls it), only for used members: inits, methods, statics,
      properties read and written, top-level functions and variables.
      Swift modules on the include paths bind; header-less SDK frameworks
      (CryptoKit) import nothing. The podspec becomes a Swift pod only when
      there are shims. Tested: the shims type-check with
      `-warnings-as-errors`, the glue with `-Werror`.
- [x] Objects as `Unmanaged`, value types boxed (`mutating` and setters in
      place), String/Data/Date/arrays/dictionaries/optionals bridged; sync
      `throws` as Lucent errors.
- [x] Enums: plain as integers; with payloads as unions discriminated by
      `kind` (payloads by label, `value`, `_0`…), crossing as a dictionary
      of the case, nested, in collections and with optional payloads;
      their members are skipped. Optional ones as arguments, and generic
      ones (slice 5), not yet.
- [x] Generics specialized per use: generic functions and methods (the
      call's type arguments), members of generic types (the receiver's),
      generic enums with payloads (generic unions); one shim per
      combination. The d.ts declares generic functions.
- [x] `async` / `async throws` (methods, functions and getters) as
      promises: a `Task` in the shim, a C callback that posts the result
      to the Lucent thread. `@MainActor`: synchronous shims are
      `@MainActor` (the main-thread rule applies), async ones run their
      task on the main actor and can be awaited from any thread. `throws`
      as errors (sync in slice 2).
- [x] What the ports need, found by compiling them: protocol extensions'
      members on conforming types (`SHA256.hash(data:)`,
      `AVAsset.load(_:)`), `Self.X` associated types, `where X.Element ==
T` collections (`Product.products(for:)`), default arguments,
      types nested in generic types (`VerificationResult<T>.VerificationError`),
      generic statics fixed by their extension (`.duration`), C structs
      as bytes, cases sharing an object type (`PurchaseResult`), memberless
      SDK enums as numbers, methods named like properties left out.
      CryptoKit, StoreKit 2 and `AVURLAsset.load(.duration)` programs
      compile (shims `-warnings-as-errors`, glue `-Werror`).
- [x] Swift-only protocols: protocol values cross as objects (members
      called on the existential); Lucent classes implement them through a
      generated `NSObject` subclass whose requirements call the glue
      through C function pointers: method, property, throwing, async and
      mutating requirements, associated types fixed by the `implements`
      clause, and `Self` as the implementing class (run on the host by
      the Orbit fixture's tests).
- [x] Podspec `swift_version` and private headers (the module CocoaPods
      makes for Swift must not include the C++ runtime), only with shims.
      Bare and Expo build and pass as static libraries. With
      `use_frameworks! :linkage => :static` the shims compile, but the build stops in the
      glue of the "linked libraries" case (a Part 1 gap: LucentNative does
      not depend on the pods it imports, so their framework headers are
      not on its path). Fixed: LucentNative now depends on the pods whose
      modules the iOS code imports (from the schema's provenance).
- [x] Fixture Swift module (Shapes) tests: schema, d.ts, shims and glue for
      each shape; shims type-check `-warnings-as-errors` (Swift 5 mode),
      glue `-Werror`.
- [x] Ports, in the example apps' SDK tab, on the iOS 27 simulator
      (Release), bare 29/29 and Expo 42/42: CryptoKit SHA-256 (FIPS
      vector), AES-GCM seal/open, P-256 sign/verify; StoreKit 2
      `products(for:)` and `Transaction.latest(for:)`; `AVURLAsset.load(.duration)`
      of a WAV it writes (1 s). Not run: `purchase()` needs a `.storekit`
      configuration, which Xcode applies only to runs it launches; the
      call compiles, and the tab's StoreKit case reads 0 products.
      Rerun 2026-09-25 (Release): bare 29/29 and Expo 42/42 on the iOS 27
      simulator and the Android emulator, differential tests 23/23 on all
      four. With `use_frameworks! :linkage => :static` the bare app builds
      and passes 29/29; a fresh `lucent build` against a framework Pods
      layout does not find pod modules yet (LUCENT3004), so framework
      builds need the static-library layout's schemas for now.
- [x] Coverage after Part 2: see the table. Top remaining reasons (UIKit,
      Foundation, AVFoundation, StoreKit, CryptoKit together): members of
      types Lucent does not bind (1,970), generics it cannot type (257),
      members of plain enums (222), Hasher (201), undeclared types (196),
      Decoder/Encoder (353), subscripts (136), statics of generic types
      (127), POSIXErrorCode/MachErrorCode (162).

## Part 3: Kotlin shims

- [ ] Spike: Kotlin metadata reader in TypeScript vs a JVM tool (report size
      and speed, then ask).
- [ ] Metadata: suspend, properties, defaults, nullability, value classes,
      extensions, top-level functions, Flow, sealed classes.
- [ ] Shim generation (LucentShims.kt), coroutines dependency only when used.
- [ ] suspend as promises (host scope, AbortSignal), Flow as subscribe,
      sealed as unions, value classes replace "Kotlin-mangled name".
- [ ] Default arguments as optional parameters; extensions and top-level
      functions as package functions.
- [ ] Golden tests on fixture Kotlin classes; shims compile in both apps.
- [ ] Ports: DataStore Preferences (edit, data Flow), Credential Manager,
      a value-class fixture.
- [ ] Coverage after Part 3 (androidx.\*), no Kotlin-mangled skips.

## Part 4: overrides and the long tail

- [ ] API notes format and loading (Lucent's files start empty; libraries
      ship `<Module>.lucent-apinotes`). The awaitable types were removed
      rather than moved there.
- [ ] `lucent sdk coverage --all` in CI, top 20 skip reasons in the job
      summary.
- [ ] Stable names golden test with two fixture SDK versions.

## Part 5: docs for the new capabilities

- [ ] Guides: Swift-only APIs, Kotlin APIs, await a Play services Task,
      `using`, API notes.
- [ ] Reference: type mapping extended; generated coverage tables.
- [ ] README and ROADMAP updated with Part 4's numbers.

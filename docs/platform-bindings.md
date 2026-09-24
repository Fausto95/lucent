# Platform bindings — what is implemented

The implemented part of [the design](design/m2-platform-bindings.md): platform
modules, binding schemas extracted on demand from the installed SDKs,
Objective-C++ and JNI glue, and `main()`. This page describes the current
behavior; the design document describes where it is going.

## Platform code

Platform code is written in one module, branching on `PLATFORM` from
`lucent:platform`; that is the standard form. Splitting a module into one
file per platform is the opt-in alternative (below).

```ts
import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
import { main } from "lucent:thread";

export async function model(): Promise<string> {
  if (PLATFORM === "ios") return main(() => UIDevice.current.model);
  else return Build.MODEL ?? "unknown";
}
```

- The tests are `PLATFORM === "ios"` and `!==` (either side, either
  platform), in `if`/`else` and in `? :`, alone or leading `&&`s
  (`PLATFORM === "ios" && ready`: the then-branch is iOS code, the
  else-branch runs on both platforms). `switch (PLATFORM)` runs each
  platform's case and what it falls through to; a clause both platforms reach
  is shared code. Each target compiles what it can run only; the host target
  throws there ("this code runs only on iOS and Android"). `PLATFORM` as a
  value is the target's name.
- A top-level declaration that uses a platform's SDK outside a branch,
  directly or through another such declaration, belongs to that platform:
  delegate classes, SDK-typed state, helpers taking SDK types. It compiles on
  that target only. A declaration using both platforms outside branches is an
  error; exports run on both platforms, so they branch inside (their
  platform code outside a branch is reported where it is used).
- A platform's code (its imports and declarations) may only be used inside
  its branch or its declarations, and `lucent:thread` in either platform's
  code (LUCENT3004 otherwise).
- Every target type-checks both branches. Where the other platform's SDK is
  not installed, its modules are untyped there and TypeScript's errors in its
  code are ignored (that code is never emitted on that target); values that
  flow out of such a branch need a type annotation.
- A module that branches is built per target, like split modules, and is
  Objective-C++ (`.mm`) on iOS.

The ports in `scripts/example-app/src/sdk` (expo-application, -clipboard,
-device, -local-authentication, -location, netinfo) and the example packages
`examples/lucent-haptics` and `examples/lucent-secure-store` are written this
way: each export branches, and each platform's helpers, delegate classes and
state sit in sections of their own.

### Split into platform files (opt-in)

When a module's platform halves share nothing, it can be split: a shared
declaration file and one implementation per platform.

```
haptics.lucent.ts          export declare function impactAsync(style?: ImpactStyle): Promise<void>;
haptics.ios.lucent.ts      the iOS implementation (imports lucent:ios/…)
haptics.android.lucent.ts  the Android implementation (imports lucent:android/…)
```

- The shared file may contain only `export declare function`s, types and
  imports (LUCENT3005 otherwise). Put shared code and enums in another
  module that all three import.
- Each implementation must export exactly the declared values, with types
  assignable to the declarations (LUCENT3005). JavaScript imports the shared
  file, so it sees one API; the proxy and the JSI bindings are the same on
  both platforms.
- Each platform is checked in its own program: in platform files,
  `lucent:ios/*` and `lucent:ios` resolve only in `.ios.lucent.ts` files,
  `lucent:android/*` and `lucent:android` only in `.android.lucent.ts` files,
  and `lucent:thread` in both (LUCENT3004 otherwise, and for SDK modules
  without a schema).
- Other modules import a platform module as usual (`./haptics.lucent`); calls
  go to the platform's implementation.

### Output

Projects without platform code keep the single layout,
`.lucent/native/cpp/generated/*`. With platform code, each target gets a
complete set: `generated/ios/*` (modules with iOS code as `.mm`, Objective-C++
with ARC) and `generated/android/*`. The podspec compiles `generated/ios`,
CMake compiles `generated/android`, and the podspec links the frameworks the
iOS code imports.

`lucent build --platforms host` writes `generated/host/*`, where platform
branches throw "this code runs only on iOS and Android" and split modules'
exports throw (or reject) "`<module>.<name>` is not available on this
platform". `scripts/app-check.ts` uses it to run the rest of an app in the
Hermes host.

## Where bindings come from

There is no list of frameworks or packages. The first time a program imports
`lucent:ios/X` or `lucent:android/p.q`, `@lucent-lang/bindgen` extracts that
module from the installed SDK and caches its schema per machine:

```
~/.cache/lucent/sdk/android/<platform>-<hash>/<package>.json   (android.jar: paths, sizes, mtimes)
~/.cache/lucent/sdk/ios/iphonesimulator<version>-<build>-<hash>/<Module>.json   (Xcode's SDK)
```

The hash also covers bindgen's own code, so a new SDK or a new extractor
extracts again. `$LUCENT_CACHE_DIR` moves the cache; `$ANDROID_HOME` (or
`$LUCENT_ANDROID_JARS`) and `$LUCENT_ANDROID_PLATFORM` choose the Android SDK;
`$LUCENT_XCRUN` (or `xcode-select`) chooses Xcode.

- **Android**: the jar is read once per process (a few hundred ms for
  android.jar), and every package it has can be imported.
- **iOS**: a module costs its symbol graph (UIKit: about 40 s, once per Xcode)
  plus clang for its enum values. Frameworks the program only meets in
  signatures (UIKit's methods take Foundation types) get **names only**: their
  types as opaque nominal classes, from their symbol graphs; importing such a
  framework gives it full declarations. Which framework declares a type comes
  from a scan of the SDK headers, once per SDK.
- Extractions take a lock per module, so a build and a prefetch never do the
  same work twice. `lucent build` starts one background extraction per cold
  module it imports, then waits for them.
- `lucent sdk prefetch [--ios A,B] [--android p.q] [--all]` extracts ahead of
  time (default: what the project imports).
- Without an SDK: a clear LUCENT3004 names the fix; `lucent build` builds the
  platforms whose SDK is installed and says which it skipped. Where a
  platform's SDK is missing, its `lucent:<platform>/*` modules are untyped,
  so shared code still type-checks.

## Binding schemas

A module's schema describes classes (native name, superclass, constructors, methods, properties,
thread rule, availability) and enums in a small type grammar: `int`, `long`,
`CGFloat`, `string`, `string?`, `long[]`, `Class<T>`, `android.os.Vibrator`,
`UIDevice`. The compiler turns each into a `.d.ts` served from a virtual
directory:

- classes are nominal (a private brand) and have a private constructor unless
  the SDK declares initializers;
- Swift names on iOS (`UIDevice.current`, `init(style:)` → `constructor(style)`),
  nested types joined with `_` (`UIImpactFeedbackGenerator_FeedbackStyle`);
- Java names on Android, plus Kotlin-style getter properties
  (`VibratorManager.defaultVibrator`);
- `T?` → `T | null`; unannotated Java references are nullable
  (`Build.MODEL: string | null`);
- `Class<T>` parameters take the class itself:
  `context.getSystemService(Vibrator)` is `Vibrator | null`.

Coverage: `lucent sdk coverage` reports, per module, the members Lucent can
call and those it can't, with the reasons; CI fails when a module's
unrepresentable share grows past `sdk-coverage.json`.
[improvement-plan-status.md](improvement-plan-status.md) records the numbers.

## Calls

- **iOS**: message sends with the SDK's own selectors, in Objective-C++
  compiled against the real headers:
  `[[UIImpactFeedbackGenerator alloc] initWithStyle:static_cast<UIImpactFeedbackStyle>(…)]`.
  Every enum value used is checked against the SDK with a `static_assert`.
- **Android**: JNI with descriptors derived from the schema types; class and
  member IDs are looked up once per call site, local references are freed per
  call, and classes the system class loader cannot see are loaded through the
  application's.
- Platform objects are `lucent::NativeRef`s: a retained Objective-C object
  (released on the main thread) or a JNI global reference. `===` compares
  identity (`IsSameObject` on Android). They cannot cross to JavaScript
  (LUCENT2006).
- Java exceptions become Lucent errors whose `code` is the exception class
  (`java.lang.IllegalArgumentException`) and whose message is the
  exception's. A `nil`/`null` result where the schema promises an object
  throws `TypeError`.

## Threads

`main(f)` from `lucent:thread` runs `f` on the main thread (the main queue;
the main Looper through a `Handler`) holding the Lucent lock, and resolves
with its result; the caller never waits for it. Main-thread-only APIs
(`mainActor` in the schema, `@MainActor` in Swift) are a compile error
outside a `main(() => …)` literal (LUCENT3006).

`available("ios", major, minor?)` and `available("android", api)` check the
running OS; `appContext()` returns the Android `Application`
(`ActivityThread.currentApplication()`).

## Verified in the spike

- `swift-symbolgraph-extract` on UIKit (iOS 27 SDK) gives clang USRs for
  Objective-C members (`c:objc(cs)UIImpactFeedbackGenerator(im)impactOccurred`,
  `(cpy)` class properties, `(py)` properties), `@MainActor` in declaration
  fragments, enum cases with their C enumerators
  (`c:@E@UIImpactFeedbackStyle@UIImpactFeedbackStyleMedium`), and
  completion-handler methods twice under one clang USR: once with the
  handler, once as Swift `async`. Extracting UIKit takes about 40 s and 29 MB,
  so extraction results need caching.
- Generated glue compiles with `-Werror` against the iOS simulator SDK and
  the NDK (`packages/compiler/test/platforms.test.ts`); derived JNI
  descriptors match `android.jar`.
- On devices (Release, iOS 27 simulator and Android 14 emulator, bare and
  Expo apps), the example apps' SDK tab passes: the `expo-haptics` port
  (`scripts/example-app/src/sdk`), SDK values, identity across threads,
  a Java exception's code, and, in the Expo app, the original
  `expo-haptics` through the same JavaScript API.
- Threads the app did not start (the Lucent thread) see only the system
  class loader on Android: framework classes resolve, app classes
  (fbjni's `NativeRunnable` and `HybridData`, AndroidX, Play services) do
  not. The main-thread hop runs inside `ThreadScope::WithClassLoader`, and
  `findClass` falls back to the Application's class loader.

## Not yet

[ROADMAP.md](../ROADMAP.md) lists what's next under M2, and
[improvement-plan-status.md](improvement-plan-status.md) what was postponed,
with the reason.

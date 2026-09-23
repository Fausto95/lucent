# Improvement plan: status

Tracks `lucent-improvement-plan.md` (Phases 1–5 on `cpp-jsi`): what is
done, what is left, and what was postponed, with the reason. Updated in the
same commit as the work it describes.

Decisions on the plan's open questions (2026-09-23): one NativeProxy for
every Java interface, measured before generating classes; single-file
platform branches after Phase 1; packages ship sources only; SDK member
names come only from the member's own signature.

## Phase 1: platform callbacks

Done:

- [x] iOS blocks as parameters. Threading comes from Swift: `@escaping`,
      `@Sendable`, `@MainActor`, and the member's actor.
- [x] iOS completion handlers as promises, from Swift's `async` form, under
      the name Swift gives it.
- [x] Lucent classes implementing iOS protocols (a generated Objective-C
      class; optional requirements stay optional).
- [x] Weak delegate properties retain their value on the owner (associated
      object).
- [x] Android: `dev.lucent.NativeProxy` (java.lang.reflect.Proxy) for
      functions as single-method interfaces and for Lucent classes
      implementing interfaces. Methods are keyed by name and descriptor, and
      default methods keep their Java body.
- [x] Android: Lucent classes extending abstract SDK classes, through a
      generated Java subclass.
- [x] Callback threading: queued on the Lucent thread unless the platform
      waits (a result, a call during the call, or the main thread).
- [x] Runtime tests for the threading (`postCallback`, `callNow`), also run
      under ASan.
- [x] Also needed along the way: `new Promise`, NSError out-parameters
      (`Out<Error>`), modules re-exported by module maps (`_LocationEssentials`),
      SDK frameworks' umbrella headers, R8 keep rules for JNI-named classes,
      Gradle outputs left alone in the native package, and comparisons of
      non-nullable values with null, C structs by value, and Android
      permissions read from `@RequiresPermission` in the SDK's `annotations.zip`
      and declared in the library's manifest. AARs' own `annotations.zip` files
      are not read yet.
- [x] Device check: the SDK tab's callbacks case passes in the bare app on the
      iOS simulator and the Android emulator.

- [x] expo-local-authentication port. Passes on iOS and Android, bare and
      Expo, with parity against the original in the Expo app.
- [x] expo-location port (permission, services, provider status, last known,
      current and watched position). Passes on iOS and Android, bare and Expo;
      in the Expo app the current position matches expo-location's.
- [x] Also found on devices: Java default methods' bodies run through
      MethodHandles (LocationListener's onLocationChanged(List)); uncaught
      errors log to logcat and the unified log; Lucent names no longer shadow
      the glue's (`id`); parameter-property functions can be called.

- [x] netinfo port (fetch, and event listeners): the Network framework's path
      monitor on iOS (OS objects, anonymous C enums, typealiased blocks,
      `mainQueue()`), a Lucent `NetworkCallback` on Android. Parity with
      @react-native-community/netinfo in both apps.
- [x] Release tests: an Objective-C++ runtime test on the macOS host (ARC,
      ASan): blocks release what they hold, the object cache is weak, and
      ErrorOut retains once.
- [x] Debug builds report the native references left at teardown.
- [x] Acceptance: all three ports pass next to the originals on the iOS
      simulator and the Android emulator. Bare 23/23 and Expo 36/36 on both
      platforms, on 2026-09-23.

Phase 1 is complete; what remains of it is postponed below.

Postponed:

- Android `Task<T>` / `ListenableFuture<T>` as promises. It would name
  specific classes in code, which the no-lists rule forbids, so it belongs in
  Phase 4's API notes. None of the three ports needs it.
- The Android biometric prompt in the local-authentication port. It needs
  the current `FragmentActivity`, which `lucent:android` does not expose.
  Without a secure lock screen (the emulator's default) the original returns
  `not_enrolled` before prompting, and so does the port.
- Cycles between Lucent objects and the native objects that retain them as
  delegates or listeners leak until removed. The teardown report (above)
  will make them visible.
- Lucent classes extending iOS classes (subclassing).
- Factory initializers (`+requestWithIdentifier:…`, which Swift imports as
  `init`) are dropped by the extractor. This belongs to Phase 4's total
  mapping.
- Generic Java classes' methods (`Consumer<T>.accept`) and `java.util`
  collections (`List`) are not bound yet: Phase 4's real type parameters. The
  location port uses a LocationListener and the platform's providers instead.
- On Android API 24 and 25, a default method Lucent does not implement
  returns its zero value (Java's MethodHandles are missing there), and the
  reason is logged.

## Phase 2: build and test reliability

- [x] SDK-bound tests skip without the SDK (Android gated like iOS).
- [x] The android.jar descriptor test runs one javap per package (37 s → 1 s).
- [x] Test runs no longer leave temporary projects behind (5,291 `lucent-*`
      directories, 9 GB, after a day of runs): vitest gives each run its own
      TMPDIR, which workers and spawned processes inherit, and removes it at
      the end.
- [x] A Gradle resolution, a failed one included, is recorded with its inputs'
      hash (`.lucent/android-classpath.state.json`) and runs again only when
      they change; watch mode resolves too, once. A build that skips a recorded
      failure says so, and `lucent build --force` retries it.
- [x] The inputs: settings.gradle, both build.gradle files, gradle.properties,
      gradle/libs.versions.toml, and the JS lockfile (found up to the
      workspace root).
- [x] Headless app check without an SDK: the host build (platform modules as
      throwing stubs) runs no Gradle, and app-check skips the device build
      where no SDK is installed. Both apps pass with the SDKs hidden
      (LUCENT_ANDROID_PLATFORM=nope, LUCENT_XCRUN=/nonexistent).
- [x] Installed pods are keyed on Podfile.lock's content; development pods
      (files outside Pods/) keep their files' identities.

Phase 2 is complete (2026-09-23). Its acceptance holds with the SDKs hidden
on macOS; no Linux machine was available to run it on one.

## Phase 3: publishing Lucent libraries

Done (docs/lucent-packages.md):

- [x] Package format: `"lucent": { "sources", "compatible" }` in package.json,
      and lucent.json for native needs. Sources only.
- [x] Discovery: the app's Lucent packages, transitively, as Node resolves
      them (links followed), for build, check and watch.
- [x] Namespacing: `<package>/<module>` for the C++ namespace, the registry
      and the proxies; the Metro transformer names files the same way.
- [x] Imports: through the package's entry; Metro swaps `.lucent` modules for
      their proxies.
- [x] Versioning: an app on a Lucent outside a package's `compatible` range
      fails to build, and the error names the package.
- [x] Native dependencies: pods, Gradle artifacts (api), permissions and
      Info.plist entries merged; two packages that disagree are an error
      naming both. The Expo plugin writes Info.plist entries; bare apps are
      told which keys are missing.
- [x] Acceptance: examples/lucent-haptics and examples/lucent-secure-store,
      installed in both apps, pass on the iOS simulator and the Android
      emulator (bare 23/23, Expo 36/36); smoke-install builds lucent-haptics
      installed from its tarball.

Left, or postponed:

- Watch mode notices changes under the app's root only; workspace packages
  outside it are rebuilt on the next change inside it.
- A lucent.json pod added after the first build takes a `pod install` before
  it can be bound.

## Phase 4: bindings from platform metadata

Parts pulled forward for Phase 1: function and error types in the schema
grammar, a recursive-descent schema type parser, requirement names from their
own Swift names, NSError out-parameters, C structs, and @RequiresPermission
from the platform's annotations.zip.

- [x] Structured schema types: types are JSON objects (SchemaType) that both
      extractors build and the compiler uses as they are; the written form is
      only for names and hand-written schemas. Output unchanged except a fix
      (optional blocks returning optionals kept their outer optionality).
- [x] Coverage report: `lucent sdk coverage` (idiomatic / raw /
      unrepresentable per module, the reasons tallied); CI records it and fails
      when a module's unrepresentable share grows past sdk-coverage.json.

- [x] Other modules' C types: the header index reads every typedef whatever
      surrounds its name (availability after it, bridging macros before it)
      and tagged struct definitions, so CoreMedia's CMTime, CMTimeRange and
      CMPersistentTrackID resolve in AVFoundation. Typedefs of a struct whose
      tag Swift hides (NSRange's `_NSRange`) are structs, and the references
      Swift leaves without a USR resolve by the typedef's name. Struct fields
      may be enums, and the glue casts each field to its own C type (Swift
      imports NSRange's NSUInteger fields as Int).
- [x] Swift's bridged value types (IndexPath, URLRequest, DateComponents,
      CharacterSet, IndexSet…) bind as the classes they bridge to, which
      Foundation's graph names (each ReferenceConvertible's ReferenceType).
      This replaces the extractor's table of four; Swift USRs name their
      module, so the owner's names load without the header index.

Coverage (unrepresentable members):

| Module | 2026-09-23 baseline | Other modules' C types | Bridged value types |
| --- | --- | --- | --- |
| UIKit | 584 of 6,067 (9.6%) | 498 of 6,065 (8.2%) | 264 of 6,054 (4.4%) |
| Foundation | 723 of 3,906 (18.5%) | 617 of 3,902 (15.8%) | 493 of 3,901 (12.6%) |
| AVFoundation | 451 of 3,527 (12.8%) | 165 of 3,516 (4.7%) | 160 of 3,516 (4.6%) |
| android.* (214 packages) | 207 of 79,136 (0.3%) | unchanged | unchanged |

Totals shrink a little as members that now type-check merge with overloads
of the same signature.

Top reasons left: pointers (ObjCBool, generic UnsafePointer and
AutoreleasingUnsafeMutablePointer, pointers to structs), Selector, AnyClass,
generic Set, AnyHashable, opaque CoreFoundation-style handles (CMSampleBuffer,
CVBuffer, CMFormatDescription); on Android, generics.

Found along the way, left:

- A struct of a module the program does not import (CGRect, reached through
  UIKit) is declared without fields until its type is imported
  (`import type { CGRect } from "lucent:ios/CoreFoundation"`).

## Phase 5: typed IR

Not started.

## Alongside

- [ ] Performance: one allocation per string; why `sieve` is slower on Linux.
- [ ] Docs: m2-platform-bindings.md, ROADMAP M2, TODO (22 e2e suites, M2).

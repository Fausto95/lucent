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

In progress:

- [ ] expo-local-authentication port. Passes on iOS (bare 17/17, and Expo 28/28
      with parity against the original) and Expo Android (28/28). Bare Android
      failed on the USE_BIOMETRIC permission, which is fixed now (declared from
      the SDK's annotations); a rerun is pending.

Left:

- [ ] expo-location port (permissions, services, last known and current
      position, watchPosition).
- [ ] netinfo port. iOS needs the Network framework's C API: opaque handle
      types (`nw_path_t`), typealiased block types, and a dispatch queue.
- [ ] Tests of callback release, and no leaks under ASan.
- [ ] Debug builds report live native references at teardown.
- [ ] All three ports next to the originals on devices, bare and Expo.

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

## Phase 2: build and test reliability

- [x] SDK-bound tests skip without the SDK (Android gated like iOS).
- [ ] A failed Gradle resolution is recorded with its input hash, so it is
      retried only when the inputs change.
- [ ] Classpath staleness hashes settings.gradle, libs.versions.toml,
      gradle.properties, both build.gradle files and the JS lockfile.
- [ ] Headless app check without an SDK (platform modules become throwing
      stubs).
- [ ] Pods staleness keyed on the Podfile.lock hash.

## Phase 3: publishing Lucent libraries

Not started.

## Phase 4: bindings from platform metadata

Not started. Parts pulled forward for Phase 1: function and error types in
the schema grammar, a recursive-descent schema type parser, requirement
names from their own Swift names, NSError out-parameters, C structs, and
@RequiresPermission from the platform's annotations.zip.

## Phase 5: typed IR

Not started.

## Alongside

- [ ] Performance: one allocation per string; why `sieve` is slower on Linux.
- [ ] Docs: m2-platform-bindings.md, ROADMAP M2, TODO (22 e2e suites, M2).

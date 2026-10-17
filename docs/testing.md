# Testing

JavaScript semantics are the contract, so most native suites are
differential. Code compiled by Lucent must print what the same TypeScript
prints as JavaScript. This page lists each suite, what it proves and needs,
and the CI job that runs it. [tasks.md](tasks.md#validation) names the
profiles a task must pass.

## Evidence levels

Each suite proves something at one level, and a higher level never
follows from a lower one. Nothing has run on a physical phone
([limitations](limitations.md#not-verified-yet)).

| Level                 | Means                                                         | Suites                                                                                          |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Code                  | Generated, type-checked, compiled or compared. Nothing ran.   | Unit tests of generated code, the corpus, NDK and header compiles, CI's app builds              |
| Host                  | Ran on a desktop: Hermes, the macOS host, Mac Catalyst, a JVM | End-to-end cases, the runtime, the JSI and JNI hosts, the platform harnesses, app checks, bench |
| Simulator or emulator | Ran on the iOS simulator or the Android emulator              | Device runs, the window apps, and the example apps run by hand                                  |

A check that could not run is not a pass. Tests whose tools are missing
are skipped (`it.skipIf(!xcode)`, `!jdk`, `!sdkAvailable("android")`), and
vitest counts them apart: report them as not run. A filter that matches
nothing proves nothing: `pnpm test:e2e <name>` with an unknown name runs
no case and exits 0.

## What the suites need

| Tool                                    | Needed by                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Node 24, pnpm 9, `pnpm install`         | Everything. The runtime tests take Yoga from the installed `react-native`.                    |
| clang and clang++ (`CC`, `CXX`), or g++ | The runtime, the e2e cases, app checks, bench; clang reads extension headers (`LUCENT_CLANG`) |
| Hermes at `~/hermes` (`HERMES_DIR`)     | E2e cases, the fuzzer, the JSI host tests, app checks, bench, `lucent bench`                  |
| Xcode with the iOS simulator SDK        | iOS bindings, the Swift and Catalyst harnesses, `lucent sdk coverage --ios`                   |
| The bare example's Pods (`pod install`) | The Mac Catalyst run tests (or `LUCENT_RN_PODS`)                                              |
| JDK 17 to 21, `kotlinc`                 | The JVM tests: the JNI host, Kotlin shims and metadata, the Compose host                      |
| Android SDK and NDK (`ANDROID_HOME`)    | Android bindings, NDK compile checks, Gradle builds                                           |
| Vale                                    | `node scripts/website.ts --check`                                                             |

Build Hermes once. `hermesc` is for the benchmarks, which otherwise run
JavaScript from source:

```sh
git clone https://github.com/facebook/hermes ~/hermes
cmake -S ~/hermes -B ~/hermes/build -G Ninja -DCMAKE_BUILD_TYPE=Release
ninja -C ~/hermes/build hermesvm jsi hermesc
```

CI pins the revision with `HERMES_REF` in `.github/workflows/ci.yml` and
builds `hermesvm jsi` (`.github/actions/hermes`).

## Unit tests

```sh
pnpm test                                    # without the slow tests
pnpm test:all                                # with them, as CI runs them
pnpm exec vp test run packages/compiler/test/packages.test.ts
```

Vitest runs `packages/*/test/**/*.test.ts`, `apps/website/test`,
`scripts/*.test.ts`, `scripts/example-app/**/*.test.ts` and
`config/*.test.ts`. The `slow` list in `vite.config.ts` names files that
build whole programs, extract an SDK cold, or compile against several
React Native releases. They run when `CI` or `LUCENT_ALL_TESTS` is set.

The global setup builds the CLI first (cached) and extracts common SDK
modules where an SDK is installed. CI shards files by their times in
`config/test-timings.json`: after adding slow tests, refresh it with
`node scripts/test-timings.ts <report.json>…`.

`dts-audit.test.ts` checks the SDK declarations without `skipLibCheck`,
error by error against `dts-audit.baseline.json`.
`LUCENT_UPDATE_DTS_AUDIT=1` rewrites the baseline.

## Code generation corpus

`scripts/codegen-corpus.ts` writes everything the compiler generates for
a corpus of programs, and compares today's output with it:

```sh
node scripts/codegen-corpus.ts write /tmp/before   # before a change
node scripts/codegen-corpus.ts compare /tmp/before # after it
```

The full corpus is every end-to-end case for the host, and both example
apps for iOS, Android and the host. Run both steps on one machine: its
SDKs shape the apps' output.

C++ is compared as tokens, so whitespace outside literals and the numbers
of temporaries (`coll_18`) don't count. Files that differ only in
parentheses or braces are counted apart and pass. Any other change, or an
added or removed file, fails with a diff.

With `--host`, the corpus is the end-to-end cases alone, without `#line`
directives: what any machine generates. It is committed in
`packages/compiler/test/corpus`, and `codegen-corpus.test.ts` (part of
`pnpm test`) fails with the diff when generated code changes. Review the
diff, then rewrite the corpus in the same commit:

```sh
pnpm corpus:write
```

A new end-to-end case adds files to the corpus, so it needs this too.

## End-to-end cases

```sh
HERMES_DIR=~/hermes pnpm test:e2e              # every case
HERMES_DIR=~/hermes pnpm test:e2e async abort  # some, by name
SANITIZE=1 pnpm test:e2e                       # ASan and UBSan
SANITIZE=thread pnpm test:e2e async compute    # TSan, for cases that cross threads
```

`packages/compiler/test/e2e/run.ts` runs each case natively and as
JavaScript:

1. It compiles the modules to C++ and builds them with the runtime and
   the Hermes host (`packages/runtime/test/jsi/harness.cpp`). The flags
   are `-std=c++20 -ffp-contract=off -O1 -Wall`, and with clang `-Werror`,
   as the NDK's `appmodules` build uses.
2. It runs the case's script in that host, through real JSI.
3. It transpiles the modules to JavaScript and runs the same script in
   Node, with the JavaScript `lucent:core`. This reference runs twice
   against the same modules and must print the same both times, since the
   example apps run a case again.
4. The two outputs must match line for line. A sanitizer report fails the
   case.

The JavaScript `lucent:core` (`packages/compiler/lib/core.cjs`, published
as `@lucent-lang/lucent/core`) differs from native in a few places a case
must not print:

- `onDestroy` hooks never run, since module state never ends.
- A `NativeBuffer` borrow lends the buffer's own bytes, where native code
  checks each borrow.
- `removeAllListeners()` clears events in the order each was first used,
  where native code goes in their declaration order.
- `compute` runs its task on the calling thread. The known differences of
  its copies are listed in [limitations.md](limitations.md).

A case is one of three shapes in `packages/compiler/test/e2e/cases/`:

| Shape        | Files                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| One module   | `<name>.lucent.ts` and `<name>.test.js`                                                                                                |
| Several      | A `<name>/` directory of `*.lucent.ts` modules, and `<name>.test.js`                                                                   |
| An extension | As several, with `extensions.json` (`{ "packages": [<package dirs>] }`) and `lucent-ext/<ext>.ts`, the extension's JavaScript stand-in |

The script sees `mod` (the first module), `mods` (every module by file
name), `print(...)` and `lucentClass(C)`, the proxies' wrapper of a
class's constructor. It prints with `print`; what Lucent code logs
through `console` is part of the output too. Cases are `.lucent.ts` only:
components are tested elsewhere (below).

| Variable           | Default            | Sets                                       |
| ------------------ | ------------------ | ------------------------------------------ |
| `HERMES_DIR`       | `~/hermes`         | The Hermes build                           |
| `LUCENT_E2E_JOBS`  | the cores          | Cases built at once                        |
| `LUCENT_E2E_CASES` | `cases/`           | Another directory of cases                 |
| `LUCENT_TEST_TZ`   | `America/New_York` | Both runs' time zone, with daylight saving |

`node scripts/sync-examples.ts` copies the one-module cases, with the
reference's lines, into both example apps' Tests screen. Run it after
every change to the cases: `scripts/sync-examples.test.ts` runs its
`--check`, which fails naming each file that differs.

## The differential fuzzer

```sh
HERMES_DIR=~/hermes pnpm test:fuzz --seed 7 --count 20 --keep /tmp/fuzz
LUCENT_E2E_CASES=/tmp/fuzz pnpm test:e2e fuzz-7
```

`e2e/fuzz.ts` writes random programs in the subset and runs each as a
case. A program refused with a LUCENT diagnostic is skipped. A type error,
`LUCENT9002`, a crash or a different output fails. One seed gives one
program on every machine, so a failure becomes a case.

`fuzz.test.ts`, a unit test, checks that the programs compile. With
`LUCENT_FUZZ=1` and Hermes, it runs three.

## The C++ runtime

```sh
pnpm test:runtime                              # packages/runtime/test/run.sh
SANITIZE=1 CXX=g++ pnpm test:runtime           # ASan and UBSan, libstdc++
SANITIZE=1 pnpm test:runtime                   # the same with clang (libc++ on macOS)
SANITIZE=thread CXX=g++ CC=gcc pnpm test:runtime
```

`run.sh` compiles the runtime once and links it with each
`packages/runtime/test/*_test.cpp`: lifetimes, actors, compute, buffers,
channels, views, sizing, slots, layout with Yoga, tracing and more. Some
check corpora against JavaScript: BigInt and number formatting against
Node, the reactive graph against `reactive/reference.ts`. `run_binary.sh`
fails a test on its status or on a sanitizer report in its output.

`stress_test.cpp` is the runtime's stress run (T151). Native operations'
registration, completion and cancellation race from four threads, and a
success races its owner's shutdown. A settlement's continuation re-enters
its context to complete, start and abort operations. Then come 1,000
subscribe and cancel cycles, and 1,000 mount and dispose cycles on the
main context, after warmup. Their owned counts (`debug::resources()`)
must return to their baseline (P7). `LUCENT_STRESS_ITERATIONS` sets the
races' rounds (300 by default).

`executor_test.cpp` is the executor bench: 1080p frames at 60 Hz, run on
an executor as a camera's delegate is, into a `latest` channel, while a
synchronous call holds the module's actor for 500 ms. It fails if the
handler waits for an actor, or if its p99 latency nears the hold, and
prints its latency and the channel's drops.

It also fails when the vendored QuickJS exports an unprefixed symbol. On
macOS it runs the Objective-C helpers and syntax-checks the UIKit glue
against the simulator SDK. The runtime's TypeScript tests (`headers`,
`loader`, `views`, `compose-host`) are unit tests.

## The JSI and JNI hosts

`packages/runtime/test/jsi/harness.cpp` is the Hermes host every native
suite links. It installs the modules as `__lucent`, adds `print`, writes
Lucent's console to stdout, and runs posted jobs, microtasks and timers
until nothing is pending.

```sh
packages/runtime/test/jsi/run.sh   # needs HERMES_DIR; SANITIZE as above
packages/runtime/test/jni/run.sh   # needs a JDK; passes with a note without one, fails in CI
```

`jsi/run.sh` checks the host's lifetime across runtimes, a hand-written
module, and the loader's check of the build identity. Its stress run
reloads four runtimes alive at once forty times, with work in flight in
each. Its sanitizer runs need `CXX=g++ CC=gcc` where clang has no
sanitizer runtime. `jni/run.sh` runs
the JNI glue (`platform/android.cpp`, built with `LUCENT_JNI_HOST`) on a
desktop JVM under `-Xcheck:jni`. Any JVM warning fails it. With
`SANITIZE=1` its leak report leaves out what the JVM keeps until exit
(`jni/lsan.supp`); there is no TSan run, as the JVM's own threads are
not instrumented.

## Platform code on the host

Slow unit tests run a program's platform code without a device:

| Harness (`packages/compiler/test/`) | Runs                                                                                                                                           | Needs                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `swift-harness.ts`                  | A program's iOS output against Swift fixture modules, with Swift `-warnings-as-errors` and Objective-C++ `-Werror`, run on the macOS host      | macOS, Xcode                                |
| `ui/mount-harness.ts`               | A component mounted on Mac Catalyst, against React Native's prebuilt renderer and Hermes                                                       | arm64 macOS, Xcode, the bare example's Pods |
| `jni-harness.ts`                    | Android glue, the JNI runtime and the host runtime in one executable that starts a JVM on the app's jars and calls `run()` under `-Xcheck:jni` | A JDK with `libjvm`                         |
| `fake-android.ts`                   | An `android.jar` for hosts without one: the JDK's `java.*` and stand-ins for the classes a test uses                                           | A JDK with `jmods`                          |
| `ui/mini-swiftui.ts`                | SwiftUI bodies where Xcode is missing: a miniature SwiftUI's symbol graph as its schema, the generated Swift type-checked against it           | `swiftc`, `swift-symbolgraph-extract`       |
| `android-harness.ts`                | Android glue compiled with the NDK's clang++; Kotlin with `kotlinc`                                                                            | The NDK, `kotlinc`                          |

The JNI host has no Android OS: the main thread is the host runtime's,
and `android.os.Build` and `android.util.Log` are stand-ins
(`test/jni-host/java`). A view's Android glue is only compiled there.
`jvmRun` also builds native extensions' own sources beside the runtime,
as the app's CMake does: `cxx-extension-jni.test.ts` runs the C++ and C
fixture libraries (`tally`, `ticker`) there.
Without Xcode, `ui/mini-swiftui.ts` builds SwiftUI bodies against
`ui/mini-swiftui/`, a miniature SwiftUI and UIKit the host's Swift
toolchain builds: it declares what tests use in SwiftUI's shapes, so its
tests check the writer, not SwiftUI.
Without the Android SDK, `ui/toolkit-build.ts` builds Compose bodies
against stand-ins for `View` and `Context`, as Compose's API comes from
`lib/sdk`'s schemas: their diagnostics and generated code are checked,
and compiling the Kotlin and glue waits for Compose's jars and the NDK.
CI's macOS shards install the bare example's pods (cached by
`Podfile.lock`), so the Mac Catalyst run tests run there.

`unknown-library.test.ts` binds and runs a library whose names are drawn
at random on every run, so nothing in Lucent can know them. On iOS its
dial mounts with props, events and commands. Its Android views need only
a JDK, through `fake-android.ts`: a gauge's props and listener, and a
panel's children, in a component of the app's own types. Their glue
compiles against the newest assembled React Native release.

`scripts/platform-names.test.ts` holds every platform name Lucent's code
says to the
[fixed platform anchors](design/contracts.md#fixed-platform-anchors).
`node scripts/platform-names.ts` lists each name, the files saying it,
and what the audit finds.

## React Native releases

```sh
node scripts/react-native-headers.ts --window
pnpm exec vp test run packages/compiler/test/ui/react-native-releases.test.ts
```

The script assembles the C++ headers of each release Lucent supports
(the window and the prerelease lane, as `lucent doctor` names them) into
`~/.cache/lucent-react-native-headers` (`LUCENT_RN_HEADERS`). It works on
Linux, with no platform SDK. The test compiles the generated Fabric
sources, the Android view host and the TurboModule against each. Nothing
is linked, and without assembled headers it is skipped.

## App checks

```sh
HERMES_DIR=~/hermes node scripts/app-check.ts apps/bare-example
HERMES_DIR=~/hermes node scripts/app-check.ts apps/expo-example
```

`scripts/app-check.ts` covers an app's pipeline but Xcode and Gradle:

1. `lucent build` on the app, skipped where no platform SDK is installed.
2. `lucent build --platforms host --out <work>`, whose platform modules
   are stubs that throw, built into the Hermes host.
3. The Tests screen's cases bundled with the app's own Metro config,
   against the host build's proxies (`LUCENT_OUT`).
4. The bundle run in Hermes: each case prints `PASS` or `FAIL`, then
   `ALL PASSED`.

The proxies carry their build's identity, so the loader refuses the device
build's proxies with the host's native code.

## Smoke install and window apps

```sh
node scripts/smoke-install.ts
node scripts/install-matrix.ts [pnpm|yarn|npm|upgrade]…
node scripts/window-app.ts --matrix
node scripts/window-app.ts --app bare --release 0.86 --platform android [--no-native]
node scripts/window-app.ts --app bare --release 0.86 --platform android --dir <app> --check
```

`smoke-install.ts` packs `@lucent-lang/lucent`, `examples/lucent-haptics`
and the `orbit-filter` fixture, and installs them with npm into an empty
project. It checks that `@lucent-lang/lucent` is the only `@lucent-lang`
package installed, without its sources. Then it runs `lucent init --yes`
and `lucent build` from the tarball, and compiles the extension's C++.

Last, it loads the Metro and Expo integrations and
`@lucent-lang/lucent/core`, and asks tsserver for the editor's
diagnostics. It builds no app.

`install-matrix.ts` builds the packed package's apps the ways real apps
install Lucent packages (T145), for the host. In a pnpm, a Yarn 4 and an
npm workspace, an app depends on two Lucent packages linked from the
workspace, which both depend on a third the app doesn't name. Each build
compiles every package's modules and copies the third's resources and
assets. An app built with the release on npm is upgraded to the packed
one, whose build must write what a clean build writes.

`window-app.ts` makes a fresh app per release of the window: bare from
React Native's template (0.86 to 0.88), Expo from `create-expo-app`'s
(SDK 57 and 58). It adds a module of each kind and a component, and an
`App.tsx` that checks them. Then it runs `lucent doctor` and `lucent
build`, and the platform's Release build for the simulator or Android.

The app depends on a local Lucent package, `lucent-window-kit`, whose
`lucent.json` declares a pod and a piece of each kind of native
configuration: a privacy manifest, `<queries>`, a feature, meta-data an
option fills (the app's own `lucent.json` sets it) and Google's Gradle
plugin. A bare app adds the Gradle lines `lucent build` names, as its
developer would; an Expo app's config plugin adds them. After the build,
the check finds each piece in the merged manifest, the plugin's
resources or the app's privacy bundle.

The package also has native inputs: Swift and Kotlin its module calls,
an SDK framework, an iOS resource, and an Android string resource and
asset. The Android Release build runs R8, which the bare template leaves
off. After it, the check finds the resource in the app, and the asset and
string resource in the APK. R8's mapping must keep the package's Kotlin
class under its name, which JNI calls it by. The app's check calls the
Swift or the Kotlin.

`--check` runs that build with `device-check.ts`: on the simulator it
boots, or on the emulator already running. The app calls the scaffolded
modules, mounts the scaffolded component and a probe that answers
through its ref, and logs its verdict as the Tests screen does.

## Device runs

```sh
node scripts/device-check.ts ios --app apps/bare-example/ios/build/Build/Products/Debug-iphonesimulator/BareExample.app
node scripts/device-check.ts android --apk apps/bare-example/android/app/build/outputs/apk/debug/app-debug.apk
node scripts/device-check.ts ios --app <LucentExpoExample.app> --example expo --no-metro
node scripts/device-check.ts android --apk apps/expo-example/android/app/build/outputs/apk/release/app-release.apk --example expo --no-metro
```

`scripts/device-check.ts` installs an example app's build on a booted
simulator or a running emulator, and opens its Tests screen. That
screen runs the one-module e2e cases through the C++ the platform's own
toolchain built. Then it opens the Platform screen, which checks what
only the platform gives module code. A launch module's state started at
launch, before JavaScript (the `lucent-launch` example package). A
background task's handler runs, and on Android a broadcast reaches a
receiver the OS makes from a Lucent class, and a `FragmentManager` makes
a Lucent `Fragment` again by its name, with its saved state. A component
whose Android root is a `Fragment` shows its view. That component's
native view has its `testID`, Android's accessibility API reads the label
its `accessibilityLabel` gives, and its `onLayout` fires. Frames
reach a channel through an executor without a copy, and the app opens a
deep link to itself. On iOS
a push registration answers, and on Android a back press and a rotation
reach the module. Last, the Media screen starts a foreground
`MediaSessionService` written in Lucent (`lucent-media`), has Android make
the Activity again, and checks that the service plays on with the new
Activity. An app may show the screen of the link that launched it in the
new Activity: `device-check.ts` then opens the Media screen again, once.
Last, the Libraries screen puts a Lucent component inside the view
libraries apps use. Reanimated animates its own style through its ref, a
Gesture Handler detector over it gets a tap (Android; on iOS, where nothing
taps, its recognizers are on the component's own view, the Fabric view's
contentView),
and it lays out in a react-native-screens stack's screen.

Each screen opens in an app started for it, on Android as on iOS. A deep
link that navigated the running app (React Native 0.88's bare Debug build)
made it lose views it had mounted: they stopped taking updates ("Unable to
find viewState"), and a component sized by its content among them stayed 0
high.

The bare example's Debug build loads its bundle from Metro: start Metro
on port 8081 first. The Expo example (`--example expo`) is built as an
Expo app is: `expo prebuild --no-install`, then `pod install` on iOS,
which builds Lucent's modules through the Podfile's hook, and the Gradle
build on Android. CI builds it for Release, which carries its bundle
(`--no-metro`).

The script follows each screen's `LUCENT_PROGRESS` lines to its
`LUCENT_SUMMARY <screen> N/M passed` verdict. It gives up early when the
app exits or a run stops moving. On failure it keeps the log, a screenshot and the summary
in `$DEVICE_CHECK_OUT`. By hand, open a screen with a deep link
(`lucentbare://lab/tests`, `lucentexpo://lab/tests`) or, on iOS, a launch
argument (`-lucentTab lab/sdk`).

With `--id <bundle id or package>` (and `--process <name>` on iOS), it
runs another app the same way, opened as its launcher opens it, which is
how the window apps run. `--no-metro` is for a Release build, whose
bundle is in the app.

## Performance budgets

```sh
HERMES_DIR=~/hermes node scripts/bench.ts --check [--json results.json]
node scripts/bench-build.ts --check [--rounds N]
```

`bench.ts` times the kernels (`cases/kernels.lucent.ts`) natively and as
JavaScript in one Hermes runtime, rounds interleaved. JavaScript runs as
`hermesc -O` bytecode when `$HERMES_DIR/build/bin/hermesc` exists, and
from source otherwise, with a warning, which flatters Lucent. It also
times the boundary, and measures the generated objects and install time.

| Budget                                    | File                                  | `--shared-runner` (CI) |
| ----------------------------------------- | ------------------------------------- | ---------------------- |
| Kernels' speedup over JavaScript          | `scripts/bench-budgets.json`          | Enforced               |
| Batched calls against 1,000 single ones   | `scripts/bench-boundary-budgets.json` | Reported               |
| One call against a bare JSI host function | `scripts/bench-floor-budgets.json`    | Reported               |
| Object sizes at `-O2`, install time       | `scripts/bench-size-budgets.json`     | Sizes enforced         |

`bench-build.ts` times the edit loop for the host: cold, no-op and
body-edit builds, a check, editor diagnostics and the edited unit's C++.
`--check` holds each p95 to `scripts/bench-build-budgets.json`. In CI,
with `--shared-runner`, a time over its budget is a warning: times move
with the runner's CPU. P5 is missed today, and why is in
[T158](tasks.md#t158).

`node scripts/bench-publish.ts <results.json>` copies a run to
`benchmarks/results/`. Comparisons with Nitro and Expo Modules are
[T153](tasks.md#t153).

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, a
nightly schedule (03:17 UTC) and by hand. Its `changes` job
(`scripts/ci-changes.ts`) maps a pull request's files to jobs:

| Job                                                 | Runs                                                                                                                                                                                  | On a pull request, when it changes                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (two Linux shards)                       | `pnpm check` (first shard), every unit test with the slow ones                                                                                                                        | Always                                                                                                                                                   |
| Unit tests with the iOS SDK (three macOS shards)    | The same suite on macOS                                                                                                                                                               | `packages/`                                                                                                                                              |
| Runtime and JSI host                                | `run.sh`, `SANITIZE=1 CXX=g++`, `jsi/run.sh` plain and with `SANITIZE=1`, `jni/run.sh` plain and with `SANITIZE=1 CXX=g++ CC=gcc`                                                     | `packages/runtime/`, the JNI host (`compiler/test/jni-host/`)                                                                                            |
| Runtime (TSan, GCC)                                 | `SANITIZE=thread CXX=g++ CC=gcc run.sh`                                                                                                                                               | `packages/runtime/`                                                                                                                                      |
| End-to-end                                          | `pnpm test:e2e`                                                                                                                                                                       | `packages/`                                                                                                                                              |
| Performance budgets, fresh install                  | `bench.ts --check --shared-runner`, `bench-build.ts --check --shared-runner`, `smoke-install.ts`, `install-matrix.ts`, each whichever failed before it                                | `packages/`, `benchmarks/`, `examples/`, `scripts/bench*`, the two install scripts                                                                       |
| React Native releases (headers)                     | `react-native-headers.ts --window`, `react-native-releases.test.ts`                                                                                                                   | The runtime, compiler or codegen, `react-native-headers.ts`, `doctor.ts`                                                                                 |
| App check (bare), App check (Expo)                  | `app-check.ts`                                                                                                                                                                        | `packages/`, the app, `examples/`, the shared example app, the two scripts                                                                               |
| Website                                             | `website.ts --check`, typecheck, build                                                                                                                                                | `packages/`, `apps/website/`, the website scripts, `docs/`, `README.md`, `ROADMAP.md`, `vercel.json`, `benchmarks/results/` and the other files it reads |
| SDK coverage, runtime (libc++)                      | `SANITIZE=1 run.sh` with clang; `lucent sdk coverage --check config/sdk-coverage.json`                                                                                                | `packages/`, `config/sdk-coverage.json`                                                                                                                  |
| Bare example (iOS simulator build), (Android build) | `pod install`, `lucent build`, `pod install`, `xcodebuild` (outside pull requests, also with `use_frameworks!` static and dynamic); `lucent build`, Android coverage, `assembleDebug` | `packages/`, the bare app and its sources                                                                                                                |
| Device run (iOS, Android), each example             | `devices.yml`: `device-check.ts` on the simulator and on an API 35 emulator, the bare example's Debug build and the Expo example's Release build                                      | Never: nightly and by hand                                                                                                                               |
| Window apps                                         | `window.yml`: `window-app.ts` for each app of the matrix                                                                                                                              | Never: nightly and by hand                                                                                                                               |
| CI                                                  | Passes when every job above but the device and window runs passed or was skipped                                                                                                      | Always                                                                                                                                                   |

A file in the `everything` list (the workflow, the lockfile,
`vite.config.ts` and more) runs every job. A `docs/` file runs the unit
tests and the website check, which builds a page from
`docs/limitations.md` and checks every doc's links into the site. A
`quiet` file (other `*.md`, `.changeset/`, other workflows) runs the unit
tests alone. A file
no area places runs everything. Pushes to `main`, nightly and manual runs
run every job, and the last two add `sdk coverage --all`, the device runs
and the window apps.

Device runs and window apps don't gate the CI check. `release.yml` runs
after CI passes on a push to `main`. `changeset.yml` fails a pull request
that changes `packages/` without a changeset, unless it has the
`no-changeset` label.

## Adding tests

### A language feature

1. Add `cases/<name>.lucent.ts` and `cases/<name>.test.js` under
   `packages/compiler/test/e2e/`, printing what the feature does and its
   edge cases.
2. Run `HERMES_DIR=~/hermes pnpm test:e2e <name>`, and check that it ran.
   Add `SANITIZE=thread` for code that crosses threads.
3. Make what Lucent refuses a `LUCENT` diagnostic, with a test in
   `diagnostics.test.ts`. A new code's wrong example must report it
   (`codes.test.ts`).
4. If native output can't match JavaScript, document why in
   [semantics.md](semantics.md) and add a row to
   `apps/website/src/docs/language.ts`. `node scripts/website.ts --check`
   (Vale) checks it against the compiler.
5. Run `pnpm corpus:write` and review the new files, then
   `node scripts/sync-examples.ts`.

### A binding shape

1. Extraction: a fixture under `packages/bindgen/test/fixtures/` (`swift`,
   `objc`, `java`, `kotlin`, `c`, `pods` and others), read by a test in
   `packages/bindgen/test/`.
2. Typing and generation on any machine: compile iOS code from schemas the
   test writes (`schema-set.ts`), and Android code against
   `fake-android.ts`.
3. A run: iOS on the macOS host (`swift-harness.ts`), Android on the JNI
   host (`jni-harness.ts`), and the glue through the NDK
   (`android-harness.ts`). Add the test file to `slow` in `vite.config.ts`
   when it builds whole programs.
4. Against real SDKs: `lucent sdk coverage` (CI's macOS job checks
   `config/sdk-coverage.json`), and `dts-audit.test.ts` when declarations
   change. Commit the `sdk-coverage` artifact's updated file when shares
   move for a reason.

### A runtime change

1. Add checks to the area's `packages/runtime/test/<area>_test.cpp`. A new
   file needs an entry in `tests=(…)` and a `run_binary` line in `run.sh`.
2. Run `run.sh` plain, with `SANITIZE=1 CXX=g++`, and with
   `SANITIZE=thread` for locks, threads or scheduling.
3. Run `jsi/run.sh` for the JSI boundary, and `jni/run.sh` for the Android
   glue, which CI doesn't run.
4. Run the e2e cases, which link the runtime. Run `pnpm build` before the
   CLI or app checks: the CLI uses the copy in `packages/lucent/runtime`.

Every new build of Lucent C++ passes `-ffp-contract=off`.

### A view change

1. Generation: a test in `packages/compiler/test/ui/` (the Fabric glue,
   SwiftUI and Compose bodies, native view JSX, with snapshots).
2. The runtime's side: `view_test`, `sizing_test`, `slots_test`,
   `layout_test`, `ui_children_test`, `items_test` or
   `view_registry_test`, and `views.test.ts` for `js/views.js`.
3. A mount: a `ui/*-run.test.ts` with its driver (`*_run_test.mm` or
   `.cpp`), through `mount-harness.ts` on Mac Catalyst. It needs
   `pod install` in `apps/bare-example/ios`.
4. Android: the glue compiled with the NDK (`android-views.test.ts`,
   `ui/android-children.test.ts`), and the Compose host's rules on the JVM
   (`compose-host.test.ts`).
5. The React Native releases job compiles the Fabric sources against each
   release. Device runs open the Tests and Platform screens only, so run a view's demo in
   the example apps by hand, on a simulator and an emulator.

## Generated files to keep in step

| Files                                            | Written by                                | Checked by                        |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------- |
| The example apps' `src/` and `App.tsx`           | `node scripts/sync-examples.ts`           | `sync-examples.test.ts`           |
| `packages/compiler/test/corpus/`                 | `pnpm corpus:write`                       | `codegen-corpus.test.ts`          |
| `packages/compiler/test/dts-audit.baseline.json` | `LUCENT_UPDATE_DTS_AUDIT=1`               | `dts-audit.test.ts`               |
| `config/sdk-coverage.json`                       | CI's `sdk-coverage` artifact (`--update`) | `lucent sdk coverage --check`     |
| `config/test-timings.json`                       | `node scripts/test-timings.ts`            | Nothing: it balances shards       |
| The examples' README evidence blocks             | `node scripts/example-evidence.ts`        | `examples.test.ts`                |
| The website's generated files                    | `node scripts/website.ts`                 | `node scripts/website.ts --check` |

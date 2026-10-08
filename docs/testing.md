# Testing

JavaScript semantics are the contract, so most tests are differential: a
module compiled by Lucent must print exactly what the same TypeScript prints
when run as JavaScript.

## Hermes

The native suites run compiled C++ inside a Hermes runtime, through real JSI.
They need a Hermes checkout built into `build/`, found through `HERMES_DIR`
(default `~/hermes`):

```sh
git clone https://github.com/facebook/hermes ~/hermes
cmake -S ~/hermes -B ~/hermes/build -G Ninja -DCMAKE_BUILD_TYPE=Release
ninja -C ~/hermes/build hermesvm jsi
```

CI pins the commit with `HERMES_REF` in `.github/workflows/ci.yml` and caches
the build.

## Suites

| Command                                       | What it checks                                                                                                                                                                                                                                         | Needs Hermes |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `pnpm test`                                   | compiler unit tests (vitest): diagnostics, platforms, native package, incremental builds, debug info, editor plugin, the CLI (commands, output snapshots, --json schemas, doctor on a fake machine, dev); without the slow ones `vite.config.ts` lists | no           |
| `pnpm test:all`                               | the unit tests with the slow ones: whole programs built and run with the platforms' toolchains, SDKs extracted into an empty cache (CI runs these)                                                                                                     | no           |
| `pnpm test:runtime`                           | C++ runtime unit tests (`packages/runtime/test/*_test.cpp`), with corpora checked against JavaScript: BigInt against node, the UI reactive graph against a JavaScript reference                                                                        | no           |
| `packages/runtime/test/jsi/run.sh`            | the JSI host across runtimes (teardown, reload, stale objects) and a hand-written module in Hermes; `SANITIZE=1` or `thread` add sanitizers                                                                                                            | yes          |
| `pnpm test:e2e [case…]`                       | differential end-to-end cases                                                                                                                                                                                                                          | yes          |
| `node scripts/app-check.ts apps/bare-example` | an example app's real Metro bundle against its generated C++                                                                                                                                                                                           | yes          |
| `node scripts/bench.ts --check`               | performance budgets                                                                                                                                                                                                                                    | yes          |
| `node scripts/smoke-install.ts`               | packed packages install and run in an empty project                                                                                                                                                                                                    | no           |
| `pnpm typecheck`                              | the repository's own TypeScript                                                                                                                                                                                                                        | no           |

## Platform code on the host

Slow tests run a program's platform code without a device:

- **iOS on the macOS host** (`packages/compiler/test/swift-harness.ts`):
  the Swift shims and Objective-C++ glue, linked with the runtime and Swift
  fixture modules, call `run()` on the Lucent thread.
- **Views on Mac Catalyst** (`test/ui/mount-harness.ts`): a component's
  Fabric glue mounts its UIKit view; a driver commits props, sends events
  and commands, and unmounts it.
- **Android on a desktop JVM** (`test/jni-harness.ts`, the desktop JNI
  host): the JNI glue, `android.cpp`'s JNI (built with `LUCENT_JNI_HOST`)
  and the host runtime start a JVM on the app's jars and call `run()`
  under `-Xcheck:jni`. There is no Android OS: the main thread is the host
  runtime's, `android.os.Build` and `android.util.Log` are stand-ins
  (`test/jni-host/java`), and an Android view's glue is only compiled.

`unknown-library.test.ts` uses all three on a native library whose names
are drawn at random on every run (T28).

## Code generation corpus

`node scripts/codegen-corpus.ts write <dir>` writes everything the compiler
generates for the end-to-end cases and both example apps (iOS, Android and
the host, with their packages); `compare <dir>` compares today's output with
it. C++ is compared as tokens, so layout changes pass. Files that then
differ only in parentheses or braces are counted apart; any other change
shows as a diff. Run it before and after a change to code generation that
should keep the output's meaning.

With `--host`, the corpus is the end-to-end cases for the host only, without
`#line` directives: what any machine generates without a platform SDK. That
corpus is committed (`packages/compiler/test/corpus`), and
`test/codegen-corpus.test.ts` (part of `pnpm test`, so CI's unit tests) fails
with the diff whenever the generated code changes. Review it, then write the
corpus again with `pnpm corpus:write` in the same commit as the change.

## Declaration audit

Apps type-check with `skipLibCheck`, so errors inside generated SDK
declarations never reach them. `packages/compiler/test/dts-audit.test.ts`
checks the declarations with library checks on: the whole closure a
program importing a sample of large SDK modules loads, compared error by
error with `dts-audit.baseline.json`. A new error fails the test, and so
does a fixed one until the baseline is rewritten:

```sh
LUCENT_UPDATE_DTS_AUDIT=1 npx vp test run packages/compiler/test/dts-audit.test.ts
```

Review the baseline's diff before committing it. Each category of error
(protocol merging, incompatible overrides, name collisions, generic
statics and arity, missing types, invalid supertypes) also has a minimal
schema that reproduces it; fixing a category flips its fixture.

## Differential end-to-end cases

`packages/compiler/test/e2e/cases/` holds pairs: `<name>.lucent.ts` (the
module) and `<name>.test.js` (a script that calls it and prints). `run.ts`:

1. compiles the module to C++ and builds it into the Hermes host
   (`packages/runtime/test/jsi/harness.cpp`), with the same `-Werror` flags
   as the NDK's `appmodules` build;
2. runs the test script against the native module through JSI;
3. runs the same script in Node against the TypeScript source, transpiled to
   plain JavaScript;
4. fails unless the two outputs match line for line.

Both runs use `TZ=America/New_York` (override with `LUCENT_TEST_TZ`) so
local-time code sees daylight saving time even on UTC machines.

Every language feature needs a case. A case that cannot match JavaScript
documents the deviation in [semantics.md](semantics.md). After changing cases,
run `node scripts/sync-examples.ts`: the example apps' on-device test
screens run the same cases.

## Sanitizers

```sh
SANITIZE=1 pnpm test:runtime            # ASan + UBSan, clang and libc++ on macOS
SANITIZE=1 CXX=g++ pnpm test:runtime    # the same with libstdc++ (CI runs both)
SANITIZE=1 pnpm test:e2e                # e2e cases under ASan + UBSan
SANITIZE=thread pnpm test:runtime       # TSan: the Lucent lock and the scheduler
```

Run the runtime suite with and without `SANITIZE=1` after every runtime change,
and with `SANITIZE=thread` after changing the lock or the scheduler.

## App check

`scripts/app-check.ts` covers the whole device pipeline except Xcode and
Gradle: `lucent build` on an example app, a host build of it
(`--platforms host --out`, platform modules as host stubs) built into the
Hermes host, the cases of the app's Tests screen bundled with the app's own
Metro config and the host build's proxies (`LUCENT_OUT`), and the bundle run
in Hermes against the native modules. The proxies carry their build's
identity, so the loader would refuse the device build's proxies with the
host's native code.

## Performance budgets

`scripts/bench.ts` times the kernels in `cases/kernels.lucent.ts`, compiled
and called over JSI, against the same code as JavaScript in one Hermes
runtime. `--check` fails when a kernel's speedup drops below its minimum in
`scripts/bench-budgets.json`. The budgets are calibrated on the CI runner.

It also times the boundary (`cases/boundary.lucent.ts`): batched calls
against 1,000 single ones (`scripts/bench-boundary-budgets.json`), and one
call against the same call to a bare JSI host function that converts like a
codegen C++ TurboModule (`scripts/bench-floor.cpp`,
`scripts/bench-floor-budgets.json`).

Budgets compare the best of 11 rounds; JavaScript and Lucent rounds
alternate, so drift affects both. `--json <file>` writes the run as data
(`packages/lucent/src/cli/bench-results.ts`, schema version 1): every
round's time as a raw sample with its median and spread, the machine and
toolchain, single-call latencies (each `add` timed alone, beside the cost of
the clock itself; Apple Silicon's clock ticks every 42 ns) and the compiled
size of the generated code. p95 is reported from 20 samples and p99 from
100; a throughput sample is the mean of a batch, not one call's latency.

`scripts/bench-build.ts` times the development loop on every differential
case module in one app, built for the host: a cold build, a build with
nothing to do, a build and a check after a function body changes. Times
include starting the CLI; the check step's own time comes from
`.lucent/build-record.json`. It takes `--rounds N` and `--json <file>`.

On devices, the example apps' Compare tab runs NitroBenchmarks
(github.com/mrousavy/NitroBenchmarks): 100,000 calls of `addNumbers` and
`addStrings` through a TurboModule, a C++ TurboModule, Nitro modules
(Swift/Kotlin and C++), an Expo module (the Expo app only) and Lucent. The
modules are the workspace packages in `benchmarks/`. Use Release builds, and
repeat runs on the Android emulator: its timings vary by a quarter between
runs.

## Devices

CI builds the bare example for the iOS simulator and for Android, but does
not run it. Before a release, run both example apps on an iOS simulator and an
Android emulator, as Release builds: every Lab screen must pass, and three
reloads must not crash. ROADMAP.md's Validation section records the last
run.

The Lab has four screens, and each runs when it opens: Tests (every e2e
case), SDK (the platform probes and the ports' parity cases), Benchmark and
Compare. Each shows its verdict in the element with testID `lucent-summary`
(`ALL PASSED`, `N FAILED`, or the benchmark's result) and logs it as one line
starting `LUCENT_SUMMARY` through Lucent's console, which reaches the device
log in Release builds too:

```sh
xcrun simctl spawn <device> log show --last 10m --predicate 'eventMessage CONTAINS "LUCENT_SUMMARY"'
adb logcat -d -s Lucent:* | grep LUCENT_SUMMARY
```

Scripts open any screen without tapping, with a deep link (the bare app's
scheme is `lucentbare`, the Expo app's `lucentexpo`) or, on iOS, a launch
argument:

```sh
adb shell am start -a android.intent.action.VIEW -d lucentbare://lab/tests com.bareexample
xcrun simctl openurl <device> lucentexpo://examples/crypto
xcrun simctl launch <device> <bundle id> -lucentTab lab/sdk
```

Routes are `examples`, `lab`, `examples/<demo>` and `lab/<tests|sdk|bench|compare>`;
a bare name (`tests`, `crypto`) works too. The apps' READMEs list the demos.
The iOS simulator asks to confirm a link from `simctl openurl` ("Open in
…?"), so unattended iOS scripts use the launch argument.

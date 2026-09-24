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

| Command | What it checks | Needs Hermes |
|---|---|---|
| `pnpm test` | compiler unit tests (vitest): diagnostics, platforms, native package, incremental builds, debug info, editor plugin, the CLI (commands, output snapshots, --json schemas, doctor on a fake machine, dev) | no |
| `pnpm test:runtime` | C++ runtime unit tests (`packages/runtime/test/runtime_test.cpp`) | no |
| `pnpm test:e2e [case…]` | differential end-to-end cases | yes |
| `node scripts/app-check.ts apps/bare-example` | an example app's real Metro bundle against its generated C++ | yes |
| `node scripts/bench.ts --check` | performance budgets | yes |
| `node scripts/smoke-install.ts` | packed packages install and run in an empty project | no |
| `pnpm typecheck` | the repository's own TypeScript | no |

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
Gradle: `lucent build` on an example app, the generated C++ built into the
Hermes host (platform modules as host stubs), the app's test screen bundled
with the app's own Metro config, and the bundle run in Hermes against the
native modules.

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
Android emulator: the test screen must be all green, and three reloads must
not crash. TODO.md records the last run.

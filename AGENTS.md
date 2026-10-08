# Lucent (cpp-jsi)

Ahead-of-time compiler: a TypeScript subset in `*.lucent.ts` becomes C++ that
React Native calls over JSI through one C++ TurboModule. No JavaScript engine
runs on the native side. Where an SDK API only Swift or Kotlin can call (a
Swift-only type or member, an AsyncSequence, a Kotlin suspend function,
default or value class), the compiler also generates Swift
(`LucentShims.swift`, `@_cdecl` functions; the pod then sets
`swift_version`) or Kotlin shims (`dev.lucent.shims`), and components'
SwiftUI or Compose bodies; the native build compiles them with the C++.
Kotlin shims need the Kotlin Android Gradle plugin in the app's build and
kotlinx-coroutines (1.7.3, or the app's newer one), which the generated
library's build.gradle applies and depends on.

## Layout

```
lucent (CLI, metro/, app.plugin.js, ts-plugin/)  →  compiler  →  typescript
                          │
                          └─ writes .lucent/native from runtime/{cpp,native,js} + generated C++
lucent               the one published package (@lucent-lang/lucent); its build
                     bundles the CLI + compiler into dist/ and copies lib/, runtime/
compiler, bindgen    private; bundled into lucent
runtime/cpp/lucent   C++ runtime (no deps) + lucent/jsi (JSI boundary)
runtime/cpp/rn       LucentModule (TurboModule)
runtime/native       podspec, CMake, iOS registration, react-native.config.js templates
runtime/js           loader, copied to .lucent/native/js/_lucent/runtime.js
```

## Rules

- [ROADMAP.md](ROADMAP.md) is the plan and its status: gates, open tasks
  with their checklists, decisions and limitations. Update a task's entry
  in the same commit as the work; record a new decision in its decisions
  log. The design is `docs/design/native-platform.md`, the shared
  interfaces `docs/design/contracts.md`.
- JavaScript semantics are the contract. Every language feature needs an
  end-to-end case in `packages/compiler/test/e2e/cases/` (`<name>.lucent.ts` +
  `<name>.test.js`). The runner compares native output with the same source
  run as JavaScript; a deviation needs a documented reason in
  `docs/semantics.md`.
- Unsupported features fail with a `LUCENT` diagnostic (`fail(node, Codes.X, …)`),
  never with invalid C++.
- Generated C++ must not depend on unspecified evaluation order (the IR's
  operations are ordered, a plan's operands lowered first in source order: see
  `operands` in `ir/lower.ts`), must not let a coroutine reference lambda
  captures, and must keep JSI objects on the JS thread (use `Host` ids).
- A change under `packages/` needs a changeset for `@lucent-lang/lucent`
  (`pnpm changeset`; CONTRIBUTING.md says what to write), unless users can't
  see it (docs, tests), which takes the `no-changeset` label.
- Runtime changes: run `packages/runtime/test/run.sh`, and with `SANITIZE=1
CXX=g++`.
- After changing e2e cases, run `node scripts/sync-examples.ts` so the example
  apps' test screens stay in sync.
- Keep headers free of names that shadow system headers (hence `jsstring.h`,
  `jserror.h`).
- Every build of Lucent C++ (podspec, CMake, test harnesses) passes
  `-ffp-contract=off`: JavaScript rounds `a * b + c` twice, and a fused
  multiply-add would not.

## Commands

```sh
pnpm install
pnpm build   # the CLI (bin/lucent.cjs) runs dist/: rebuild after changing packages/ (cached)
pnpm dev     # vp pack --watch: rebuilds dist/ as TypeScript changes (runtime/ and lib/ need pnpm build)
packages/runtime/test/run.sh
HERMES_DIR=~/hermes node packages/compiler/test/e2e/run.ts [case…]
HERMES_DIR=~/hermes node scripts/app-check.ts apps/bare-example
HERMES_DIR=~/hermes node scripts/bench.ts --check   # performance budgets
node scripts/bench-build.ts --check   # the edit loop's feedback budgets (p95)
pnpm check   # vp check (Oxfmt, Oxlint) and tsc; pnpm fix formats and applies lint fixes
pnpm test    # unit tests without the slow ones; pnpm test:all (and CI) run them too
node scripts/smoke-install.ts   # packs @lucent-lang/lucent, installs it alone in a fresh app
node scripts/cli-recording.ts   # re-records assets/cli.svg (the README's terminal animation) after CLI output changes
```

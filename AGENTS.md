# Lucent (cpp-jsi)

Ahead-of-time compiler: a TypeScript subset in `*.lucent.ts` becomes C++ that
React Native calls over JSI through one C++ TurboModule. No JavaScript engine,
Swift or Kotlin runs on the native side.

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

- [ROADMAP.md](ROADMAP.md) is the plan in brief: principles, gates and
  what's next. The work itself is recorded in the same commit as the
  change: a task's status and checklist in `docs/tasks.md` (a new task
  takes the next free id), a decision as a new
  `docs/decisions/NNNN-<slug>.md` with a row in its README, a limitation
  found or lifted in `docs/limitations.md`. The design is
  `docs/design/native-platform.md`, the shared interfaces
  `docs/design/contracts.md`.
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

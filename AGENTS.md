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

- JavaScript semantics are the contract. Every language feature needs an
  end-to-end case in `packages/compiler/test/e2e/cases/` (`<name>.lucent.ts` +
  `<name>.test.js`). The runner compares native output with the same source
  run as JavaScript; a deviation needs a documented reason in
  `docs/semantics.md`.
- Unsupported features fail with a `LUCENT` diagnostic (`fail(node, Codes.X, …)`),
  never with invalid C++.
- Generated C++ must not depend on unspecified evaluation order (see
  `FnEmitter.inOrder`), must not let a coroutine reference lambda captures, and
  must keep JSI objects on the JS thread (use `Host` ids).
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
npx tsc --noEmit -p tsconfig.json
node scripts/smoke-install.ts   # packs @lucent-lang/lucent, installs it alone in a fresh app
node scripts/cli-recording.ts   # re-records assets/cli.svg (the README's terminal animation) after CLI output changes
```

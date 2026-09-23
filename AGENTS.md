# Lucent (cpp-jsi)

Ahead-of-time compiler: a TypeScript subset in `*.lucent.ts` becomes C++ that
React Native calls over JSI through one C++ TurboModule. No JavaScript engine,
Swift or Kotlin runs on the native side.

## Layout

```
cli / metro / expo / ts-plugin  →  compiler  →  typescript
                          │
                          └─ writes .lucent/native from runtime/{cpp,native} + generated C++
runtime/cpp/lucent   C++ runtime (no deps) + lucent/jsi (JSI boundary)
runtime/cpp/rn       LucentModule (TurboModule)
runtime/native       podspec, CMake, iOS registration, react-native.config.js templates
runtime/js           loader used by generated proxies
```

## Rules

- JavaScript semantics are the contract. Every language feature needs an
  end-to-end case in `packages/compiler/test/e2e/cases/` (`<name>.lucent.ts` +
  `<name>.test.js`). The runner compares native output with the same source
  run as JavaScript; a deviation needs a documented reason in
  `docs/language.md`.
- Unsupported features fail with a `LUCENT` diagnostic (`fail(node, Codes.X, …)`),
  never with invalid C++.
- Generated C++ must not depend on unspecified evaluation order (see
  `FnEmitter.inOrder`), must not let a coroutine reference lambda captures, and
  must keep JSI objects on the JS thread (use `Host` ids).
- Runtime changes: run `packages/runtime/test/run.sh`, and with `SANITIZE=1
  CXX=g++`.
- After changing e2e cases, run `npx tsx scripts/sync-examples.ts` so the example
  apps' test screens stay in sync.
- Keep headers free of names that shadow system headers (hence `jsstring.h`,
  `jserror.h`).
- Every build of Lucent C++ (podspec, CMake, test harnesses) passes
  `-ffp-contract=off`: JavaScript rounds `a * b + c` twice, and a fused
  multiply-add would not.

## Commands

```sh
pnpm install
packages/runtime/test/run.sh
HERMES_DIR=~/hermes npx tsx packages/compiler/test/e2e/run.ts [case…]
HERMES_DIR=~/hermes npx tsx scripts/app-check.ts apps/bare-example
npx tsc --noEmit -p tsconfig.json
```

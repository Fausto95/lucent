# Bare React Native example

A React Native 0.88 app whose only screen runs Lucent's end-to-end test cases
(`src/lucent/*.lucent.ts`, synced from `packages/compiler/test/e2e/cases`)
through the compiled C++ modules. It shows ✅/❌ per case, and **ALL PASSED** at
the top when everything matches.

## Run it

From the repository root:

```sh
pnpm install
cd apps/bare-example
pnpm lucent                                # lucent build → .lucent/native
(cd ios && bundle install && bundle exec pod install)
pnpm ios                                   # or: pnpm android
```

`pnpm ios` and `pnpm android` run `lucent build` first. After adding or removing
`*.lucent.ts` files, run `pod install` again on iOS.

## What gets linked

`react-native.config.js` points the `lucent` dependency at
`.lucent/native`. React Native autolinks it:

* iOS: the `LucentNative` pod; the TurboModule registers itself at load time.
* Android: `.lucent/native/android/CMakeLists.txt` is added to the app's
  `appmodules` library (pure C++ autolinking).

## If something fails

* **Build error in generated C++**: the file and line are in `.lucent/native/cpp/generated`.
  `#line` directives map most errors back to the `.lucent.ts` source.
* **"Lucent: the native module is not linked"**: run `lucent build`, then
  `pod install` (iOS), then rebuild the app.
* **A case shows ❌**: tap it to see expected vs actual lines.

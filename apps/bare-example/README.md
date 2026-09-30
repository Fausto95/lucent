# Bare React Native example

A React Native 0.88 app built with Lucent: native modules written in
TypeScript (`*.lucent.ts`), compiled to C++ and called over JSI. It opens on
**Examples**, focused demos of what an app does with them, and has a **Lab**
with the checks behind them.

`App.tsx` and `src/` are generated from `scripts/example-app` (and
`scripts/example-app-bare`, for what only this app has) by
`node scripts/sync-examples.ts`: edit them there.

## Examples

Each demo is a small Lucent module and one screen; the screen names the
Lucent capability it shows and its source files.

| Demo                | Shows                                                        | Native code                                                  |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Haptics & clipboard | feedback patterns, copy and paste                            | `lucent-haptics` package, `src/sdk/clipboard.lucent.ts`      |
| Secure storage      | a secret in the Keychain / Android Keystore                  | `lucent-secure-store` package                                |
| Device & battery    | the device, the app, battery and power state                 | `src/demos/device/battery.lucent.ts`, `src/sdk/*`            |
| Network status      | the connection, and each change as it happens                | `src/sdk/netInfo.lucent.ts`                                  |
| Files               | notes written, listed, read and deleted in the sandbox       | `src/demos/files/sandbox.lucent.ts`                          |
| Location            | the permission flow, the position, a watch                   | `src/sdk/location.lucent.ts`, `locationPermission.lucent.ts` |
| Biometric sign-in   | Face ID / Touch ID with cancellation; Android's capabilities | `src/demos/biometrics/biometrics.lucent.ts`                  |
| Crypto              | SHA-256, HMAC-SHA256, AES-256-GCM, with test vectors         | `src/demos/crypto/crypto.lucent.ts`                          |
| Image filter        | the same pixel code natively and as JavaScript, timed        | `src/demos/compute/pixels.lucent.ts`                         |
| Background work     | a long computation with progress and cancellation            | `src/demos/tasks/primes.lucent.ts`                           |

## Lab

Each screen runs when it opens and shows its verdict at the top (testID
`lucent-summary`):

- **Tests**: every end-to-end case (`src/lab/tests`, synced from
  `packages/compiler/test/e2e/cases`) through the compiled C++, against the
  lines the same code prints as JavaScript. **ALL PASSED** when everything
  matches; tap a case for its lines.
- **SDK**: the platform probes and the ports' parity cases.
- **Benchmark**: compute kernels in Lucent against the same TypeScript in
  Hermes.
- **Compare**: NitroBenchmarks, Lucent next to Turbo and Nitro modules.

## Automation

Open any screen without tapping, with a deep link (scheme `lucentbare`) or,
on iOS, a launch argument:

```sh
adb shell am start -a android.intent.action.VIEW -d lucentbare://lab/tests com.bareexample
xcrun simctl openurl booted lucentbare://examples/crypto
xcrun simctl launch booted org.reactjs.native.example.BareExample -lucentTab lab/sdk
```

Routes: `examples`, `lab`, `examples/<demo>` (`haptics`, `secure-store`,
`device`, `network`, `files`, `location`, `biometrics`, `crypto`, `compute`,
`tasks`) and `lab/<screen>` (`tests`, `sdk`, `bench`, `compare`). A bare
name works too (`-lucentTab tests`). The iOS simulator asks to confirm a
link from `simctl openurl`, so unattended iOS scripts use `-lucentTab`.

When a Lab screen finishes, it logs one line, in Release builds too:

```sh
xcrun simctl spawn booted log show --last 10m --predicate 'eventMessage CONTAINS "LUCENT_SUMMARY"'
adb logcat -d -s Lucent:* | grep LUCENT_SUMMARY   # LUCENT_SUMMARY tests 23/23 passed
```

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
`*.lucent.ts` files, run `pod install` again on iOS. Timings in the Lab and
the Image filter demo only mean something in Release builds.

## What gets linked

`react-native.config.js` points the `lucent` dependency at
`.lucent/native`. React Native autolinks it:

- iOS: the `LucentNative` pod; the TurboModule registers itself at load time.
- Android: `.lucent/native/android/CMakeLists.txt` is added to the app's
  `appmodules` library (pure C++ autolinking).

## If something fails

- **Build error in generated C++**: the file and line are in `.lucent/native/cpp/generated`.
  `#line` directives map most errors back to the `.lucent.ts` source.
- **"Lucent: the native module is not linked"**: run `lucent build`, then
  `pod install` (iOS), then rebuild the app.
- **A Lab check fails**: its row shows the expected and actual lines.

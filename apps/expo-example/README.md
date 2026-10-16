# Expo example

An Expo SDK 58 app with the same screens as the [bare example](../bare-example/README.md):
**Examples**, focused demos of native modules written in TypeScript with
Lucent, and a **Lab** with the checks behind them. The config plugin of
`@lucent-lang/lucent` (`"plugins": ["@lucent-lang/lucent"]` in `app.json`)
runs `lucent build` during prebuild and makes sure `react-native.config.js`
links `.lucent/native`.

`App.tsx` and `src/` are generated from `scripts/example-app` by
`node scripts/sync-examples.ts`: edit them there. `App.web.tsx`, the web
entry, comes from `scripts/example-app-expo`. Where the bare app
compares nothing, the Lab's SDK screen here also runs each original package
(`expo-haptics`, `expo-location`, `expo-secure-store`, …) next to its Lucent
port, through the same JavaScript API.

## Automation

Open any screen without tapping, with a deep link (scheme `lucentexpo`) or,
on iOS, a launch argument:

```sh
adb shell am start -a android.intent.action.VIEW -d lucentexpo://lab/tests dev.lucent.expoexample
xcrun simctl openurl booted lucentexpo://examples/crypto
xcrun simctl launch booted dev.lucent.expoexample -lucentTab lab/sdk
```

The routes, and the `LUCENT_SUMMARY` line each Lab screen logs when it
finishes, are the bare example's: see its README. CI's device runs build
this app for Release, after `expo prebuild` and `pod install`, and run its
Tests and Platform screens on the simulator and the emulator
(`node scripts/device-check.ts ios --app <.app> --example expo --no-metro`).

## Run it

From the repository root:

```sh
pnpm install
cd apps/expo-example
pnpm prebuild          # expo prebuild --clean (runs lucent build)
pnpm ios               # or: pnpm android
```

After changing `*.lucent.ts` files, run `pnpm lucent` (or prebuild again) and
rebuild. Expo Go cannot load custom native code: use a development build
(`expo run:ios` / `expo run:android`).

## On the web

`pnpm web` (`expo start --web`) runs the app's web entry, `App.web.tsx`,
with React Native Web. Metro bundles each Lucent module as its JavaScript:
the tasks demo's module runs as it is, and the crypto demo's and the
status bar's have web twins (`*.web.lucent.ts`). CI exports it with
`expo export --platform web` and runs it in Chromium
(`node scripts/web-check.ts apps/expo-example`).

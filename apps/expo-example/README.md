# Expo example

Expo SDK 58 app with the same test screen as the bare example. The
`@lucent-lang/expo` config plugin runs `lucent build` during prebuild and makes
sure `react-native.config.js` links `.lucent/native`.

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

# lucent-haptics

[expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)' API,
written in Lucent as a package: `UIImpactFeedbackGenerator`,
`UINotificationFeedbackGenerator` and `UISelectionFeedbackGenerator` on
iOS, and the `Vibrator` with expo-haptics' vibration patterns on Android.

```ts
import {
  ImpactFeedbackStyle,
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "lucent-haptics";

await impactAsync(ImpactFeedbackStyle.Medium);
await selectionAsync();
```

## Files

- `src/haptics.lucent.ts`: the module, `impactAsync`, `notificationAsync`
  and `selectionAsync`, with the same enums as expo-haptics.
- `index.ts`: re-exports the module; Metro bundles its proxy.
- `package.json`: `"lucent": { "sources": "src" }` makes it a Lucent
  package, which an app compiles with its own modules.

## What it shows

- Main-thread-only UIKit classes called inside `main(() => …)`.
- `VibratorManager` on API 31 and later, `Vibrator` before, chosen with
  `available("android", 31)`; the permission `VIBRATE` is declared by
  Lucent itself, from the SDK's `@RequiresPermission`.
- The package's page on the website:
  [Haptics](https://lucent-lang.dev/docs/packages/examples/haptics/).

## Build and check it

Both example apps depend on it (`"lucent-haptics": "workspace:*"`), and
their Lab's SDK screen runs it beside expo-haptics. On its own:

```sh
cd examples/lucent-haptics
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles it without either SDK (platform code becomes
stubs that throw); with Xcode or the Android SDK, `lucent build` types each
branch.

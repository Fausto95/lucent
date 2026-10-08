# lucent-rating (experimental views)

Native views from Lucent components, as a package an app installs:

- **`Like`** (`src/like.lucent.tsx`): a like button in one file, SwiftUI
  on iOS and Jetpack Compose on Android. A tap fills the heart, pops it
  with a spring and adds one to the count. Moved from the views spike
  (`apps/bare-example/.views-spike`), where it ran on the iOS simulator
  and the Android emulator.
- **`Rating`** (`src/rating*.lucent.ts*`): a star rating made of the
  platforms' own controls, a `UISlider` under a label of stars on iOS and
  Android's `RatingBar`, with props, an `onChange` event and `clear()`
  and `value()` commands.

```tsx
import { useRef } from "react";
import { Button, View } from "react-native";
import { Like, Rating } from "lucent-rating";

export function Review() {
  const rating = useRef<{ clear(): void; value(): Promise<number> }>(null);

  return (
    <View style={{ padding: 24, gap: 16 }}>
      <Like count={41} />
      <Rating
        ref={rating}
        value={3}
        onChange={(n) => console.log("rated", n)}
        style={{ height: 80 }}
      />
      <Button title="Clear" onPress={() => rating.current?.clear()} />
    </View>
  );
}
```

> Views are in preview: their API changes without notice.

## Files

| File                                                         | What it is                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/like.lucent.tsx`                                        | One file: each `PLATFORM` branch returns its toolkit's body. The like is a `signal`, the component's own state across React's renders.              |
| `src/rating.lucent.ts`                                       | The declaration file: `RatingProps`, and `Rating` returning `UIView \| View`.                                                                       |
| `src/rating.ios.lucent.tsx`, `src/rating.android.lucent.tsx` | Each platform's views as JSX. Platform files, because the commands use each platform's own views and `expose()` can't stand in a `PLATFORM` branch. |
| `src/stars.lucent.ts`                                        | The logic both platforms share: clamping the value, and the stars as text.                                                                          |
| `index.ts`                                                   | The package's components, imported from `lucent:views/<module>`.                                                                                    |

## What it shows

- **SwiftUI and Compose as JSX.** Modifiers are attributes
  (`foregroundStyle`, `scaleEffect`, `Modifier.clickable(…)`), and an
  animation reads the signal it animates.
- **UIKit and Android views as JSX.** An attribute is a writable property
  on iOS (`UISlider.value`) and a one-value setter on Android
  (`RatingBar.setRating`); `onValueChanged` is a `UIControl` event and
  `onRatingBarChange` the one-method listener of
  `setOnRatingBarChangeListener`. `Flex` lays the iOS views out with Yoga.
- **Props, events and commands.** `effect` follows `props.value`;
  `props.onChange` reaches JavaScript; `expose()` gives the ref its
  methods, and one that returns a value becomes a promise.

## Build and check it

Components compile only for a platform whose SDK is installed: a
component's views are that platform's classes. On a Mac with Xcode, or
with the Android SDK:

```sh
pnpm install && pnpm build                       # at the repository root
cd examples/lucent-rating
node ../../packages/lucent/bin/lucent.cjs build --platforms ios   # or android
```

To see them, add `"lucent-rating": "workspace:*"` to an example app's
`dependencies` and render them, or run `node scripts/views-spike.ts
--entry like.js` for the original spike.

`--platforms host` can't build this package: without an SDK, the
declaration file's `UIView | View` and the toolkits are untyped, and the
compiler refuses them (LUCENT3004, LUCENT2001), as it does the website's
view samples on a machine without an SDK. `src/stars.lucent.ts` compiles
on its own with `--platforms host`.

`Like` ran on the iOS simulator and the Android emulator as part of the
spike. `Rating` is new here and not yet compiled against either SDK: it
was written on Linux, where neither is installed.

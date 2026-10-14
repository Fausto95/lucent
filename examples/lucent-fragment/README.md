# lucent-fragment

A `Fragment` written in Lucent, which Android's `FragmentManager` makes
again by its name when it restores it. iOS has no fragments.

```ts
import { showAndRestore } from "lucent-fragment";

await showAndRestore(); // "made 2, views 2, restored kept"
```

## Files

- `src/panel.android.lucent.ts`: the fragment, `Panel`, exported and
  extending `Fragment`, so the OS makes it by its Java name,
  `dev.lucent.app.lucent_fragment.panel.Panel`. Its `onCreate` calls
  `super.onCreate`, and `onSaveInstanceState` keeps what the restored
  panel gets back. `showAndRestore` shows it over the Activity's content,
  then saves and restores its back stack entry, as Android does when it
  recreates the Activity.
- `src/panel.ios.lucent.ts`: iOS's side, which has nothing to show.
- `src/panel.lucent.ts`: what JavaScript sees on both platforms. It
  doesn't declare `Panel`, which only Android makes.
- `lucent.json`: the `androidx.fragment` dependency.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- A class the OS makes by name, written in Lucent: a `FragmentManager`
  restoring a fragment calls its constructor without arguments, which
  makes the Lucent side through the native root.
- Lifecycle methods that call the base's through `super`, and run while
  Android waits for them.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Compiled for the host, without either SDK, by the example packages' unit test. Not yet typed against the SDKs, or run on a simulator, an emulator or a device.

<!-- /evidence -->

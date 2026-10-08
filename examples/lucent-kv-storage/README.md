# lucent-kv-storage

A key-value store written in Lucent: one module that calls `UserDefaults`
on iOS and `SharedPreferences` on Android, with no Swift or Kotlin. It
stores strings, numbers and booleans, JSON values as text, and tells
listeners about every write.

```ts
import { Store, watch } from "lucent-kv-storage";

const settings = new Store("settings");
settings.set("theme", "dark");
settings.set("volume", 0.8);
settings.setJSON("recent", ["a.txt", "b.txt"]);

settings.getNumber("volume"); // 0.8
settings.keys(); // ["recent", "theme", "volume"]

const controller = new AbortController();
watch((change) => console.log(change.key, change.removed), controller.signal);
```

## Files

- `src/storage.lucent.ts`: the native module. Each export branches on
  `PLATFORM`: a `UserDefaults` suite named `lucent.kv.<store>` on iOS, a
  private `SharedPreferences` file of the same name on Android.
- `index.ts`: the JavaScript API, a `Store` class over the module's
  functions, and JSON on top of strings.

## What it shows

- **Calling Foundation and the Android SDK from one module.**
  `UserDefaults.set(_:forKey:)` takes `Any?`, so a string, a number or a
  boolean passes as is. `SharedPreferences` has no `double`: numbers are
  stored as their text, which reads back exactly.
- **Caching native objects in module state.** Suites are kept in a `Map`
  only iOS code uses; an SDK object can't be a field of a class that both
  platforms compile.
- **Events.** `watch` hands JavaScript's callback to `subscribe()` from
  `lucent:core`; aborting the signal removes the listener.
- **Synchronous calls.** Every export but `watch` is synchronous and runs
  on the JS thread: preferences are an in-memory cache on both platforms.

## Build and check it

```sh
pnpm install && pnpm build                       # at the repository root
cd examples/lucent-kv-storage
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles the module without either SDK: platform code
is untyped and becomes stubs that throw. On a Mac with Xcode, or with the
Android SDK, `lucent build` types each platform's branch against the SDK.
To run it, add the package to an app's `dependencies`, as the example
apps do with `lucent-haptics`.

Compiled with `--platforms host` on Linux. Not yet run on a simulator, an
emulator or a device.

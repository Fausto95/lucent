# lucent-launch

A launch module: `lucent.json`'s `launch` lists `launch`, so the app
creates it at launch, before the first frame and before any JavaScript.
Its state then lasts for the app's process, and a reload keeps it.

```ts
import { channelReady, startedAtMs } from "lucent-launch";

startedAtMs(); // when module state started, before JavaScript
channelReady(); // whether launch created the notification channel (Android)
```

## Files

- `src/launch.lucent.ts`: the module. Its top level records when it ran,
  and on Android creates a notification channel.
- `lucent.json`: `"launch": ["launch"]`, the module's path under the
  package's sources.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- Code that runs at launch, with no JavaScript runtime: on iOS from
  `LucentAppDelegate`'s `application(_:didFinishLaunchingWithOptions:)`,
  on Android from `LucentInitializer`, before `Application.onCreate`.
- The Android SDK at that point: the app's context, and a system service.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Compiled for the host, without either SDK, by the example packages' unit test. Not yet typed against the SDKs, or run on a simulator, an emulator or a device.

<!-- /evidence -->

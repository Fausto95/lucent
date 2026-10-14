# lucent-media

A media3 `MediaSessionService` written in Lucent, playing in the
foreground. Android makes it by its name, and it outlives the Activity
that started it. iOS has no such service: its media sessions belong to
the app.

```ts
import { outliveActivity, start, status } from "lucent-media";

await start(); // "1 made, 0 ended, playing in the foreground"
await outliveActivity(); // after Android made the Activity again: "made again; 1 made, 0 ended, …"
await status();
```

## Files

- `src/playback.android.lucent.ts`: the service, `Playback`, exported and
  extending `MediaSessionService`, so Android makes it by its Java name,
  `dev.lucent.app.lucent_media.playback.Playback`. `onCreate` calls
  `super.onCreate`, then plays a silent clip in a loop through an ExoPlayer
  and a `MediaSession`, which media3 keeps in the foreground.
- `src/playback.ios.lucent.ts`: iOS's side, which has no service.
- `src/playback.lucent.ts`: what JavaScript sees on both platforms. It
  doesn't declare `Playback`, which only Android makes.
- `lucent.json`: media3, the foreground service permissions, the service,
  named by its Lucent class, `playback#Playback`, with its
  `mediaPlayback` type and media3's intent filter, and the clip among the
  package's assets.
- `android/assets/lucent-silence.wav`: one second of silence.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- A foreground service written in Lucent, which Android makes by name
  from the manifest, and whose lifecycle methods call the base's through
  `super`.
- A service that holds its module's state while it lives, so the Activity
  that started it can be made again.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Compiled for the host, without either SDK, by the example packages' unit test. Not yet typed against the SDKs, or run on a simulator, an emulator or a device.

<!-- /evidence -->

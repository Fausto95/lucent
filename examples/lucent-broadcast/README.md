# lucent-broadcast

A `BroadcastReceiver` written in Lucent, which Android makes by its name
for each broadcast to it. iOS has no broadcast receivers.

```ts
import { heard, send } from "lucent-broadcast";

send(); // a broadcast to the receiver
heard(); // "1 dev.lucent.example.PING", once it arrives
```

## Files

- `src/ping.android.lucent.ts`: the receiver, `Ping`, exported and
  extending `BroadcastReceiver`, so the OS makes it by its Java name,
  `dev.lucent.app.lucent_broadcast.ping.Ping`.
- `src/ping.ios.lucent.ts`: iOS's side, which has nothing to receive.
- `src/ping.lucent.ts`: what JavaScript sees on both platforms. It doesn't
  declare `Ping`, which only the OS makes.
- `lucent.json`: the manifest's receiver, named by its Lucent class,
  `ping#Ping`.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- A class the OS makes by name, written in Lucent: its constructor makes
  the Lucent side through the native root, holding the module's actor.
- A manifest component that names a Lucent class instead of Java the
  package ships.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Compiled for the host, without either SDK, by the example packages' unit test. Not yet typed against the SDKs, or run on a simulator, an emulator or a device.

<!-- /evidence -->

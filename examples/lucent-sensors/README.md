# lucent-sensors

The accelerometer and the gyroscope, written in Lucent: one module that
reads CoreMotion's `CMMotionManager` on iOS and registers a
`SensorEventListener` with Android's `SensorManager`, and streams samples
to JavaScript.

```tsx
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { type Sample, magnitude, watch } from "lucent-sensors";

export function Shake() {
  const [sample, setSample] = useState<Sample>();

  useEffect(() => {
    const controller = new AbortController();
    watch("accelerometer", 50, setSample, controller.signal).catch((e: Error) => {
      if (e.name !== "AbortError") console.error(e);
    });
    return () => controller.abort();
  }, []);

  return <Text>{sample ? `${magnitude(sample).toFixed(2)} g` : "…"}</Text>;
}
```

## Files

- `src/sensors.lucent.ts`: the module. `availability()`, `watch(kind,
intervalMs, onSample, signal)` and `magnitude(sample)`.
- `lucent.json`: links CoreMotion on iOS. Android needs no permission for
  these two sensors.

## What it shows

- **A callback API as a stream.** iOS's `startAccelerometerUpdates(to:
withHandler:)` takes a block; Android takes a listener object. Both are
  registered inside `subscribe()` from `lucent:core`, whose cleanup stops
  the updates when JavaScript aborts the signal.
- **Implementing an SDK interface.** `Readings` is a Lucent class that
  `implements SensorEventListener`; Lucent generates the Java class that
  calls it.
- **Units and clocks.** Android reports m/s² and a nanosecond `long`
  timestamp (a `bigint` in Lucent); the module converts to iOS's g and to
  milliseconds, so JavaScript sees one shape on both platforms.
- **Errors with codes.** A device without the sensor rejects with
  `E_SENSOR_UNAVAILABLE`, which JavaScript reads as `error.code`.

## Build and check it

```sh
pnpm install && pnpm build                       # at the repository root
cd examples/lucent-sensors
node ../../packages/lucent/bin/lucent.cjs build --platforms host
```

`--platforms host` compiles the module without either SDK: platform code
is untyped and becomes stubs that throw. On a Mac with Xcode, or with the
Android SDK, `lucent build` types each branch against the SDK. The iOS
simulator has no accelerometer or gyroscope: `availability()` reports
both `false` there.

Compiled with `--platforms host` on Linux. Not yet typed against the SDKs
or run on a device.

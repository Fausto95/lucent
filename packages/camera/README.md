# @lucent-lang/camera

Gate B camera package (roadmap P79–P81). Feature orchestration belongs in
Lucent; this package ships library bindings and FakeSdk-style CI native stubs.
Physical device preview is not required for the CI pass.

## What works in CI

- `CameraPermission` union + `requestPermission()` / `permissionState()` /
  `setPermission()` (CI stub cycles all union states)
- Owned `CameraSession` with `start` / `stop` / `close` (idempotent close)
- Session interruption stubs: `interrupt(reason)` / `restart()` /
  `interrupted` / `interruptionReason`
- `frames(callback)` subscription with borrowed `Frame` buffers
- Callback contract: `retention: "subscription"`, `executor: "worker"`,
  `errors: "notify"`, `backpressure: "latest"` (keep-latest; CI stub increments
  `droppedFrames()` under reentrant/interrupted pressure)
- Free helpers `width` / `height` / `rowStride` / `pixelStride` / `sample`
- `deliverSynthetic(...)` for harness delivery without a device camera
- `CameraPreview` NativeView binding stub (placeholder Text; hosts that support
  package views can mount it)
- Lucent sources under `lucent/`: borrowed-frame luminance and
  `session-lifecycle.lucent.tsx` using `resource()` + sync `effect()`
- Compile tests in `test/library.test.ts`
- `pnpm exec tsx scripts/verify-camera-package.ts` — Swift/Kotlin session + frames
- `pnpm exec tsx scripts/verify-camera-stress.ts` — 100 create/close cycles;
  session **and** frame counters return to baseline
- `pnpm exec tsx scripts/verify-camera-race.ts` — FakeBarrier start/stop/close race
- `pnpm exec tsx scripts/verify-camera-perf.ts` — synthetic frame latency p50/p95
  (writes `packages/bench/results/`; budgets remain provisional)

## Device-only (not covered by CI stubs)

- Real AVFoundation / CameraX preview and capture
- Live permission prompts and OS interruption recovery on supported hosts
- Mount/unmount stress against a physical camera pipeline
- Host Expo / Nitro wiring for a live preview surface
- Latency budgets against device cameras (see `docs/budgets.md`)

Pass criteria from P79 are **not** fully met until those device paths land.
This package proves the Lucent API surface, borrowed-frame contracts, drop
counters, interruption stubs, and session teardown compile on both backends
with zero open frames/sessions in CI.

## Usage

```ts
import { CAMERA_LIBRARY } from "@lucent-lang/camera";
import { compile } from "@lucent-lang/compiler";

compile(source, {
  fileName: "app.lucent.ts",
  libraries: { "@lucent-lang/camera": CAMERA_LIBRARY },
});
```

The FrameDelegate luminance harness in `examples/camera` remains separate and
is still verified by `scripts/verify-camera-frames.ts`.

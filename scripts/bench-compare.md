# Comparing Lucent vs handwritten native

Gate D measurement procedure (P76–P78). Use this when filling
[`docs/budgets.md`](../docs/budgets.md). Harness timers under `packages/bench`
are probes only until a handwritten baseline exists.

## Prerequisites

- Same host machine class (or documented CI runner image)
- Same Xcode / `swiftc` and JDK / `kotlinc` / NDK as recorded in the baseline's `TOOLCHAIN.md`
- Physical device for camera / BLE / location workloads (simulator numbers are not budget evidence)
- Lucent candidate built with `pnpm verify` green for that commit

## Steps

1. **Pick a workload** that has sources under
   `packages/bench/handwritten-baseline/{swift,kotlin}/<workload>/` and a matching
   Lucent path (package or fixture).
2. **Build Lucent native** for that workload (`lucent build` or the package verify
   script). Note the generated Swift/Kotlin under the host out dir.
3. **Build the handwritten baseline** with the recorded toolchain flags (no extra
   optimization flags beyond what the Lucent path uses for release).
4. **Measure** wall time, latency percentiles, throughput, or binary size as listed
   in `docs/budgets.md`. Prefer the same runner script for both sides.
5. **Record** Lucent value, baseline value, ratio / delta, commit SHA, device model,
   and toolchain versions.
6. **Update** `docs/budgets.md` only when the comparison is reproducible twice on the
   same class of device.

## Compile-only probes (not budgets)

```bash
pnpm --filter @lucent-lang/bench micro:compile
pnpm --filter @lucent-lang/bench macro:camera-luminance
```

These time `compile()` in Node. They do **not** replace device budgets.

## Camera perf (when available)

If `scripts/verify-camera-perf.ts` lands, run it on device, capture the JSON/report
artifact, and copy provisional numbers into `docs/budgets.md` with a note that they
are pre-baseline until the handwritten Swift/Kotlin path is measured in lockstep.

Until that script exists, leave camera frame-callback budget cells as **baseline TBD**.

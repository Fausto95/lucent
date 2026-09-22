# Lucent performance budgets

Provisional budget table for Gate D (P77 / P78). Numbers stay **baseline TBD**
until handwritten Swift/Kotlin baselines under
[`packages/bench/handwritten-baseline/`](../packages/bench/handwritten-baseline/)
are measured with matched toolchains and devices. Micro/macro harness output must
not be treated as a release claim.

`scripts/verify-camera-perf.ts` measures synthetic frame-processing latency on
CI stubs and writes `packages/bench/results/camera-frame-latency.json`. Those
p50/p95 figures are **provisional** until compared against handwritten baselines
per [`scripts/bench-compare.md`](../scripts/bench-compare.md).

| Workload                        | Metric            | Budget       | Baseline |
| ------------------------------- | ----------------- | ------------ | -------- |
| Camera luminance compile        | wall time (ms)    | baseline TBD | TBD      |
| Camera frame callback (CI stub) | latency p50/p95   | provisional  | TBD      |
| Camera frame callback (device)  | p50 / p99 (ms)    | baseline TBD | TBD      |
| SQLite open/transaction/close   | wall time (ms)    | baseline TBD | TBD      |
| BLE scan → connect → close      | wall time (ms)    | baseline TBD | TBD      |
| Streaming chunk pipeline        | throughput (MB/s) | baseline TBD | TBD      |
| Background job schedule         | schedule latency  | baseline TBD | TBD      |
| Host package cold start         | startup (ms)      | baseline TBD | TBD      |
| Generated binary size (iOS)     | size (MB)         | baseline TBD | TBD      |
| Generated binary size (Android) | size (MB)         | baseline TBD | TBD      |

## Measurement procedure

1. Implement or check out the handwritten reference under
   `packages/bench/handwritten-baseline/{swift,kotlin}/<workload>/`.
2. Follow [`scripts/bench-compare.md`](../scripts/bench-compare.md) (same toolchain,
   same device class, two reproducible runs).
3. Record Lucent value, baseline value, commit SHA, device, and toolchain in the
   PR that updates this table.
4. Prefer device numbers for camera / BLE / location; mark simulator-only rows
   explicitly if they must appear at all.

## Harnesses

- Micro: `packages/bench/scripts/compile-micro.ts` (`pnpm --filter @lucent-lang/bench micro:compile`)
- Macro: `packages/bench/scripts/compile-camera-luminance.ts` (`pnpm --filter @lucent-lang/bench macro:camera-luminance`)
- Camera frame latency (CI stub): `pnpm exec tsx scripts/verify-camera-perf.ts`
- Compare guide: [`scripts/bench-compare.md`](../scripts/bench-compare.md)

See also [`docs/release-evidence.md`](release-evidence.md) Gate D.

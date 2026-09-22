# Lucent benchmarks

Stub package for Gate D measured optimization (P76). It does **not** publish
performance claims; it only hosts harnesses and places for future baselines.

## Microbenchmarks

Focused compiler and runtime micro cases, for example:

- function calls, arithmetic, loops
- records, arrays, closures
- native calls, object handles, async, events, buffers

The `scripts/compile-micro.ts` harness times `compile()` of
`fixtures/add.lucent.ts` for N iterations and prints elapsed milliseconds. That
is a timing probe for local iteration, not a claim about release performance.

`scripts/compile-camera-luminance.ts` times compile of the camera luminance
orchestration (`packages/camera/lucent/luminance.lucent.ts`) as a macro probe.

## Macrobenchmarks

End-to-end workloads (camera frames, database, streaming, Bluetooth, image
work) belong here once packages and hosts can run them reproducibly.

## Budgets (P77 / P78)

Agreed budgets require **handwritten** Swift/Kotlin (and host) baselines under
matched toolchains and devices. Stub layout:
[`handwritten-baseline/`](./handwritten-baseline/). Comparison steps:
[`scripts/bench-compare.md`](../../scripts/bench-compare.md). See
[`docs/budgets.md`](../../docs/budgets.md) for the table (`baseline TBD`). Do not
treat harness output as a budget result until those baselines exist.

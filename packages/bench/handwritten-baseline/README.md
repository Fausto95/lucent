# Handwritten native baselines

Stub folder for Gate D (P77 / P78). Place matched Swift and Kotlin reference
implementations of acceptance workloads here so Lucent-generated output can be
compared under the same toolchain and device.

## Layout

```text
handwritten-baseline/
  README.md          ← this file
  swift/             ← Swift reference sources (one workload per subfolder)
  kotlin/            ← Kotlin reference sources (one workload per subfolder)
```

Suggested workload folders (create when a baseline exists):

- `camera-luminance/` — frame luminance path matching `@lucent-lang/camera`
- `sqlite-txn/` — open / transaction / close
- `ble-scan-connect/` — scan → connect → close

## Rules

1. Implement the **same observable contract** as the Lucent fixture (inputs,
   outputs, error codes). Do not optimize away work Lucent must perform.
2. Record toolchain versions (`swiftc`, Xcode, `kotlinc`, JDK, NDK) next to
   the sources in a `TOOLCHAIN.md`.
3. Measure with the procedure in [`scripts/bench-compare.md`](../../../scripts/bench-compare.md).
4. Copy approved numbers into [`docs/budgets.md`](../../../docs/budgets.md).

Until those baselines land, budget cells stay **baseline TBD**. Do not treat
`packages/bench` micro/macro compile timers as release claims.

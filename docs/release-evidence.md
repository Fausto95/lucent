# Release evidence pointer

What evidence exists **today** toward Gates A–E and P90. This is an inventory,
not an approval. Update when packages or verify scripts land.

## Gate A — Semantic foundation

| Asset                             | Location                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Versioned semantics               | [`docs/semantics.md`](semantics.md) (0.1.0)                                        |
| Fake SDK / contract harness       | `@lucent-lang/fake-sdk` (`packages/fake-sdk`)                                      |
| Fake SDK verify                   | `scripts/verify-fake-sdk.ts` (close/late-callback/subscription races)              |
| HIR validation                    | `packages/compiler` (`validateHIR`, `test/hir.test.ts`)                            |
| Resources / cells / subscriptions | `@lucent-lang/core/{resources,cells,subscriptions}`, `scripts/verify-resources.ts` |
| `resourceScope` / `scope.own`     | `LucentResourceScope`, conformance `positive-resource-scope`                       |
| Resource / async effect slots     | Camera `session-lifecycle`, `LucentEffectRunner`                                   |
| Move / copy                       | `packages/compiler/test/move-copy.test.ts`                                         |
| Protocol `implements`             | `packages/compiler/test/protocol-implements.test.ts`                               |
| Task groups                       | `scripts/verify-task-groups.ts`, `@lucent-lang/core/tasks`                         |
| Conformance fixtures              | `fixtures/conformance/` (+ `packages/compiler/test/conformance.test.ts`)           |
| Function effects on HIR           | `IRFunction.effects`, inferred in lowering                                         |

## Gate B — Camera vertical slice

| Asset                     | Location                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| Camera package            | `@lucent-lang/camera` (`packages/camera`)                                 |
| Package verify            | `scripts/verify-camera-package.ts`                                        |
| Frame / delegate harness  | `scripts/verify-camera-frames.ts`, `examples/camera`                      |
| Camera stress             | `scripts/verify-camera-stress.ts` (100 cycles, sessions+frames)           |
| Camera race               | `scripts/verify-camera-race.ts`                                           |
| Camera perf               | `scripts/verify-camera-perf.ts` → `packages/bench/results/` (provisional) |
| Preview / interrupt stubs | `CameraPreview` NativeView, interrupt/restart/drop counters               |

Physical device preview, permission recovery, and host UI stress (P79–P81) remain
open; CI stubs and Lucent orchestration compile on both backends.

## Gate C — Generality (BLE, DB, location, background, streaming)

| Package           | Specifier                 | Evidence                                                  |
| ----------------- | ------------------------- | --------------------------------------------------------- |
| Bluetooth         | `@lucent-lang/bluetooth`  | In-memory scan/connect/notify + `verify-gate-c` / overlay |
| SQLite / database | `@lucent-lang/sqlite`     | In-memory rollback + `scripts/verify-sqlite-tx.ts`        |
| Location          | `@lucent-lang/location`   | Permission/stale/duplicate rules + gate-c                 |
| Background jobs   | `@lucent-lang/background` | schedule/runOnce versioning + gate-c                      |
| Streaming         | `@lucent-lang/streaming`  | Bounded queue + cancel + gate-c                           |

Also: `lucent-overlay.json` per package, `validateOverlay`, `verify-overlay-retention`.
Compatibility overview: [`docs/conformance-matrix.md`](conformance-matrix.md).
Device-matrix and full P87 fault injection remain open.

## Gate D — Measured optimization

| Asset                 | Location                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| HIR optimize pipeline | constant-fold, DCE, dead-branch, escape log, reachability **removal**      |
| Opt-in compile flag   | `compile({ optimize: true })`                                              |
| CLI analyze/explain   | `lucent build --analyze` / `--optimize` / `--explain`                      |
| Bench harnesses       | `packages/bench` + handwritten-baseline stubs + `scripts/bench-compare.md` |
| Budget docs           | [`docs/budgets.md`](budgets.md) (procedure filled; baselines provisional)  |

Approved device budgets vs handwritten native (P77–P78) remain open.

## Gate E — Production candidate

| Asset                          | Location                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Package model docs + validator | [`docs/packages.md`](packages.md), `validateLucentPackage` in `@lucent-lang/host-core` |
| Language service               | diagnose, hover, **gotoDefinition**, **findReferences**                                |
| Source map stub (P35 partial)  | `compile({ sourceMap: true })` → `lucent.map.json`; `--emit hir` writes it             |
| CLI emit / pack                | `--emit hir                                                                            | ast`; `lucent pack`; [`scripts/smoke-fresh-install.md`](../scripts/smoke-fresh-install.md) |
| Release engineering checklist  | [`docs/release.md`](release.md)                                                        |
| P90 checkboxes                 | [`docs/P90-checklist.md`](P90-checklist.md) — still mostly unchecked for devices       |
| Compatibility matrix           | [`docs/conformance-matrix.md`](conformance-matrix.md)                                  |

## Still not a P90 release

- Physical-device camera / BLE / location / background evidence on Expo + Nitro
- Handwritten native performance baselines with approved CI budgets
- Full source maps from Swift/Kotlin compiler errors to Lucent
- npm publish + fresh-install verification from the registry
- Full IDE (rename, ownership visualization, generated native preview)

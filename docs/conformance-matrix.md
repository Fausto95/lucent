# Conformance matrix (P87)

Shared semantic acceptance across backends, hosts, build modes, and OS ranges.
This document records **what Gate B/C CI covers today** versus **device/host**
coverage. An unexplained flaky test or divergent host semantic is a blocking
issue, not a pass with retries.

## Dimensions

| Dimension | Required coverage                                                       | Status today                                                                                                 |
| --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Backend   | Swift and Kotlin                                                        | **Tested** in package verify scripts (`verify-camera-package`, `verify-gate-c`) and compiler fixture goldens |
| Host      | Expo and Nitro for each advertised integration                          | **Planned** — package libraries compile; host wiring for P79–P86 remains open                                |
| Mode      | Development and release; optimized and baseline compiler paths          | **Partial** — CI runs default/dev paths; release + optimization parity **planned** (P73–P78 / P87)           |
| OS        | Declared minimum + representative supported versions                    | **Planned** — CI uses host toolchains (`swiftc` / `kotlinc`), not device OS matrices                         |
| Execution | Simulator/emulator where valid + physical devices for hardware          | **Partial** — fake/CI stubs **tested**; simulators and devices **planned**                                   |
| Lifecycle | Mount/unmount, close, cancellation, suspension, reload, process restart | **Partial** — close/teardown and compile conformance **tested**; host reload/restart **planned**             |

## Package × evidence

| Package                   | Roadmap | Compile / library tests | Native CI stubs (Swift+Kotlin)                                                  | Host Expo/Nitro | Physical device |
| ------------------------- | ------- | ----------------------- | ------------------------------------------------------------------------------- | --------------- | --------------- |
| `@lucent-lang/camera`     | P79–P81 | **CI stub**             | **CI stub** (`verify-camera-package`, stress, race, perf)                       | Planned         | **Device-only** |
| `@lucent-lang/bluetooth`  | P82     | **CI stub**             | **CI stub** (`verify-gate-c`, overlay retention) — scan queue / buffer overflow | Planned         | **Device-only** |
| `@lucent-lang/sqlite`     | P83     | **CI stub**             | **CI stub** (`verify-gate-c`, `verify-sqlite-tx` rollback)                      | Planned         | **Device-only** |
| `@lucent-lang/location`   | P84     | **CI stub**             | **CI stub** (`verify-gate-c`) — permission change / stale+duplicate drops       | Planned         | **Device-only** |
| `@lucent-lang/background` | P85     | **CI stub**             | **CI stub** (`verify-gate-c`) — schedule / cancel / runOnce version check       | Planned         | **Device-only** |
| `@lucent-lang/streaming`  | P86     | **CI stub**             | **CI stub** (`verify-gate-c`) — bounded transform queue + cancel                | Planned         | **Device-only** |

**CI stub** = in-memory / FakeSdk-style natives exercised by Swift+Kotlin verify
harnesses. **Device-only** = real hardware / OS APIs not exercised in CI.

## Fault injection (planned)

For each P79–P86 package, P87 still requires:

- Native errors, delayed completion, late callbacks, cancellation races
- Ownership transfer / borrowed escape / executor violation fixtures
- Optimization-enabled vs baseline result comparison
- Live-resource counters at quiescence
- Stale host handles after disposal/reload

Fake SDK + package stubs establish deterministic compiler/runtime behavior.
Real SDK overlays establish whether platform contracts match. Neither replaces
the other.

## Exit criterion

A versioned matrix with reproducible results and explicit unsupported
combinations. Gate C scaffolds land the package contracts and CI stub smoke;
full P87 exit remains open until host/device rows above move from Planned to
Tested.

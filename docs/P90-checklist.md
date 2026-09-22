# P90 — Final production release criteria

Unchecked copy of roadmap P90. Attach evidence to each item before approving a
production release. Progress snapshot: [`release-evidence.md`](release-evidence.md).

**Do not check device / handwritten-baseline / npm-publish items** until the
evidence truly exists. Partial tooling notes are listed at the bottom.

## Language and compiler correctness

- [ ] The supported language subset and execution model are documented and versioned.
- [ ] Ownership, borrowing, move, cancellation, resource-close, callback, error, and executor rules have positive and negative conformance tests.
- [ ] HIR and typed native IR carry resolved semantics; backends do not independently reinterpret them.
- [ ] Unsupported syntax, ambiguous overloads, unsafe escapes, and invalid platform API use produce actionable diagnostics.
- [ ] Optimization preserves results, observable effects, resource lifetimes, and error/cancellation behavior.
- [ ] Cache invalidation and clean-build comparisons show equivalent outputs.

## Runtime and native safety

- [ ] Close is idempotent; completion reflects actual native quiescence.
- [ ] Disposal of a JS wrapper cannot invalidate an active native operation.
- [ ] Callback retention, weak delegates, reentrant removal, and late delivery pass stress tests.
- [ ] No known release-blocking use-after-release, double cleanup, data race, deadlock, or resource leak remains in supported paths.
- [ ] Runtime checks required for safety remain in release builds unless proven unnecessary.
- [ ] Trusted SDK overlays are versioned and backed by contract tests.

## Acceptance features

- [ ] Camera passes functionality, lifecycle stress, and measured frame-processing tests.
- [ ] Bluetooth passes scanning, connection, binary data, timeout, reconnection, and teardown tests.
- [ ] Database passes transaction, rollback, commit/cancellation, typed data, persistence, and close tests.
- [ ] Location passes permissions, accuracy, lifecycle, delivery, and subscription cleanup tests.
- [ ] Background jobs pass expiration, retry, process restart, payload upgrade, and idempotency tests within declared platform capabilities.
- [ ] Streaming passes data integrity, bounded memory, backpressure, cancellation, and sustained-load tests.
- [ ] Feature orchestration is authored in Lucent. Every remaining handwritten native adapter is inventoried and limited to justified platform plumbing.

## Performance and compatibility

- [ ] Each acceptance workload has a reproducible handwritten native baseline and approved regression budget.
- [ ] Reports distinguish compile-time estimates from measured allocations, copies, executor hops, host crossings, and throughput.
- [ ] There are no unintended JS round-trips inside native processing chains.
- [ ] Queue depth and retained buffers remain bounded under overload.
- [ ] Startup, binary size, compilation time, latency, CPU, and memory meet the release's recorded budgets on its supported device matrix.
- [ ] Expo and Nitro preserve the same Lucent semantics across supported backends and build modes.

## Developer and release readiness

- [ ] Compiler and IDE share semantic metadata and resolution rules.
- [ ] Native build failures map back to Lucent source, with a documented escape hatch to generated code.
- [ ] Fresh installation, package consumption, release builds, upgrade, and rollback/pinning are verified.
- [ ] Documentation includes complete examples, capability limits, unsafe/unsupported cases, and migration guidance.
- [ ] All release-blocking defects are resolved; deferred features and unsupported combinations are explicitly recorded.
- [ ] CI evidence, benchmark reports, compatibility matrix, native adapter inventory, and release notes identify the exact candidate being approved.

## Partial progress notes (not completion)

These items have **tooling stubs** only. Leave the checkboxes above unchecked.

| Theme                         | What exists today                                                                          | Still missing                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Optimization safety           | HIR passes + differential export test (`optimize` on/off)                                  | Full effect/lifetime equivalence suite            |
| IDE / compiler shared rules   | `diagnose`, `hover`, `gotoDefinition`, `findReferences` via `@lucent-lang/language-server` | Autocomplete, rename, ownership hints, LSP wire   |
| Native → Lucent mapping (P35) | `lucent.map.json` IR name → Lucent span stub; `--emit hir` writes it                       | Swift/Kotlin diagnostic remapping pipeline        |
| Fresh install / pack          | `lucent pack`, `scripts/smoke-fresh-install.md`, publish steps in `docs/release.md`        | Verified registry publish + consumer smoke on npm |
| Performance budgets           | Table + measurement procedure; handwritten-baseline stub folder                            | Device numbers, `verify-camera-perf`, baselines   |
| Acceptance features (device)  | CI package / gate-c / camera frame stubs                                                   | Physical device matrix evidence                   |

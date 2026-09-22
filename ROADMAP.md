# Roadmap

Where Lucent stands against the P0–P90 production plan. Evidence lives in
[docs/release-evidence.md](docs/release-evidence.md). P90 checkboxes:
[docs/P90-checklist.md](docs/P90-checklist.md).

Updated 2026-09-22. Experimental — not a production release.

## Gates

| Gate                        | Focus                                                | Status                                                                   |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| **A** Semantic foundation   | HIR, ownership, resources, fake-sdk, scopes, effects | **Partial** — CI and compiler evidence; sanitizer/source maps incomplete |
| **B** Camera vertical slice | Session, frames, stress/race/perf verifies           | **Partial** — CI stubs; physical device preview open                     |
| **C** Other packages        | BLE, SQLite, location, background, streaming         | **Partial** — in-memory natives + gate-c; real SDKs open                 |
| **D** Measured optimization | Fold, DCE, reachability, analyze/explain             | **Partial** — opt-in passes; approved device budgets open                |
| **E** Release readiness     | LSP stubs, pack, docs                                | **Partial** — foundations; npm publish and full IDE open                 |

## Done enough to use in examples

- Compile → Expo / Nitro on iOS and Android
- Ownership / borrow checks, resource close + leases, subscriptions, cells
- `resourceScope`, move/copy, task groups, async `effect`, `resource()` slots
- Protocol `implements` against library metadata
- Fake-sdk races and package verify scripts in `pnpm verify`

## Next

1. Real-device camera (and host UI) on Expo + Nitro
2. Wire one other package to a real SDK (SQLite or BLE)
3. Handwritten performance baselines and CI budgets
4. Publish `@lucent-lang/*` and a fresh-install smoke path

## Out of scope for 1.0

General C/C++ FFI, GPU shaders, unrestricted inheritance, reflection, and
claiming every native API works adapter-free.

## Plan detail

The original P0–P90 phase text (semantics, acceptance criteria, delivery
gates) is the design target behind this tracker. Gate exit criteria and the
final checklist are in [docs/P90-checklist.md](docs/P90-checklist.md) and
[docs/release.md](docs/release.md). Do not treat illustrative APIs in older
design notes as shipped until this file and the evidence doc say so.

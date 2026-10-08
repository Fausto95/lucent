# 0016. The IR is the default lowering

- **Date:** 2026-10-01
- **Status:** accepted

Every function, method,
accessor, constructor, module `init()` and compute task variant compiles
through the semantic IR; the legacy emitter remains selectable
(`LUCENT_LOWERING=legacy`) for comparisons until its paths are removed,
and still writes component setups (behind `LUCENT_VIEWS`). _Why:_ the IR
lowers the whole e2e corpus and both example apps, with the same
results, diagnostics and performance budgets. _Changed:_ generated C++
reads differently (values named `v3_`, parameters `p0_`), which the
codegen corpus baseline has to take.

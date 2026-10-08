# 0053. Benchmarks run JavaScript as release builds do

- **Date:** 2026-10-08
- **Status:** accepted

The kernels' JavaScript baseline was source Hermes ran unoptimized; release builds ship `hermesc -O` bytecode. `scripts/bench.ts` now compiles it so (when hermesc is built), which lowers the measured speedups (mandelbrot 14x → 5.4x on the development container) without changing the budgets: they were calibrated as minimums, and the CI runner's numbers decide whether one needs a new decision. The generated code's object size gets a budget, enforced everywhere, and the install time one reported on shared runners. _Why:_ a speedup against unoptimized JavaScript claimed more than an app would see.

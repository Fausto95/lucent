# 0025. CI reports the boundary and floor ratios, a stable machine enforces them

- **Date:** 2026-10-03
- **Status:** accepted

On CI (`bench.ts --check --shared-runner`) the budgets
that compare one crossing with another (the boundary's batched cases
against 1,000 calls, one call against a C++ TurboModule's) are printed
with the runner's CPU and raised as warnings, not failures; the kernels'
speedups against JavaScript, on the same machine and with wide margins,
still fail the run. _Why:_ GitHub's runners differ in CPU from run to
run, and those ratios with them: the same commit measured `structsIn1000`
at 1.6x and 2.2x (budget 1.75x), so the job failed by the machine drawn,
not by the code. _Changed:_ the budgets themselves are unchanged and
`--check` without the flag enforces them all, as on the development
machine and the integration gate.

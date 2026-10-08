# 0019. The `structsIn1000` budget is 1.75x

- **Date:** 2026-10-03
- **Status:** accepted

Passing 1,000
`{x, y}` structs may cost up to 1.75x as much as 1,000 `add()` calls,
up from 1.5x. _Why:_ it measured 1.38–1.45x on the development machine
(Apple silicon) and 1.63–1.67x on the x64 Linux CI runner, before and
after the IR. A profile puts about a third of it in two JSI
`getProperty` reads per struct, which Hermes serves without a property
cache, and most of the rest in reading each element and allocating its
struct: the conversion's own work, whose cost against a host call
depends on the CPU. Moving each loop element instead of copying it
(2026-10-03) removed the one avoidable cost found. 1.75x still fails a
real regression: the conversion cost 3.2x before T10's optimizations.
_Changed:_ `scripts/bench-boundary-budgets.json`; the other boundary
budgets are unchanged.

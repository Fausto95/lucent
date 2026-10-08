# 0017. The legacy emitter's function paths are retired

- **Date:** 2026-10-01
- **Status:** accepted

Only the
IR lowers functions, methods, constructors, modules' `init()` and task
variants; `LUCENT_LOWERING` and its fallbacks are gone, and what the IR
cannot lower is a LUCENT diagnostic. _Why:_ the IR carries the whole
corpus with the same results, so a second path only hid gaps. _Changed:_
component setups still lower their statements with the emitter's code
until the view work moves them onto the IR.

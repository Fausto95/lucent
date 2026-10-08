# 0015. The IR plans leaves with the emitter's code

- **Date:** 2026-10-01
- **Status:** accepted

What the IR
does not model itself (a member read, a builtin or SDK method, a
construction, a literal of an array or object) is a `plan` operation on
values the IR computed first, in order; its C++ comes from the emitter's
existing code for that leaf, its subexpressions being named values.
_Why:_ the builtin and SDK semantics are some 5,000 lines; writing them
again for the IR would duplicate them, and the IR's job is order,
control flow, places, closures, exceptions and suspension, not the C++
spelling of each runtime call. _Changed:_ T53 migrates by moving
structure into the IR and keeping leaves where they are; once every
function goes through the IR, the emitter keeps its leaf code and loses
its statement and ordering code.

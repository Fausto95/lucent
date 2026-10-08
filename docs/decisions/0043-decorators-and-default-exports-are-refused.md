# 0043. Decorators and default exports are refused

- **Date:** 2026-10-06
- **Status:** accepted

Both
report a diagnostic (LUCENT1005, LUCENT3003) instead of compiling to a
class whose decorators never run or an export JavaScript sees under its
own name. _Why:_ a decorator can replace what it decorates at class
definition, which a static native class can't follow, and the proxy
exports names; `export function f` is the exact equivalent.
_Changed:_ docs/semantics.md's Modules and classes sections.

# 0094. Exports that would share an entry point get none, with a warning

- **Date:** 2026-10-13
- **Status:** accepted

Amends [0091](0091-entry-points-are-c-functions-named-for-their-export.md),
which failed the build when two exports' entry points,
`lucent_<module>_<export>`, come out with the same name. Each character but
letters and digits becomes `_`, so `a_b.c` and `a.b_c` both come out as
`lucent_a_b_c`. Neither export then gets an entry point. The build warns
with LUCENT3016, naming both, and compiles the rest.

_Why:_ an app with such names compiled before entry points existed, and
most exports are never called from native code, so failing its build
would break code that never needed the name. Giving the name to neither
keeps it from moving to the other export when one of them is renamed or
removed. The warning still says what to rename when native code calls one.
_Changed:_ 0091's clash rule, and
[native-platform.md](../design/native-platform.md#native-entry-points).

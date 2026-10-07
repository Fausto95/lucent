# 0004. Full SDK plan

- **Date:** 2026-09-24
- **Status:** accepted

Swift values cross as boxed references
only; Kotlin extension functions are receiver-first functions, never
methods; Swift shims need no Xcode or Swift beyond React Native's. A
private `packages/codegen` with a full syntax tree per language replaced
string templates in every emitter; the one-line edits to Gradle, podspec
and keep-rule templates stay line edits. `@IntDef` arguments outside
their group warn (`LUCENT3008`) instead of narrowing the parameter's type.
_Why:_ these answered the plan's open questions; the codegen package came
first so that everything after it, the Swift and Kotlin shims included,
generates code through it.

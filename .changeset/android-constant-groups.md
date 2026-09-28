---
"@lucent-lang/lucent": patch
---

Android constant groups: annotation types holding constants (Play services' `Priority`) are enums, results annotated `@IntDef` or `@StringDef` (from the SDK's `annotations.zip` and each AAR's own) are the union of their constants, and passing a literal or constant outside a parameter's group is the new warning LUCENT3008. Warnings don't fail the build: `lucent build` and `lucent check` print them, their `--json` output lists them under `warnings`, and the editor shows them as warnings. AARs' `@RequiresPermission` annotations are read too.

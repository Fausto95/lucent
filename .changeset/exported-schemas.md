---
"@lucent-lang/lucent": minor
---

Type iOS code without Xcode: `lucent sdk lock --schemas` exports the schemas the code uses to `lucent-sdk.schemas/`, which you commit. Where a platform's SDK isn't installed (a Linux CI, a teammate on Linux), `lucent check` and `lucent build` read that platform's bindings from it, so its code type-checks and generates instead of going untyped.

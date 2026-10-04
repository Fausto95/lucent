---
"@lucent-lang/lucent": patch
---

Build a Lucent package that lives inside the app (a workspace under `packages/`, a `file:` dependency) once, as the package: linked as a dependency it no longer fails with LUCENT3010, and when the app does not depend on it, it stays out of the app's build, `lucent init` and `lucent bench`.

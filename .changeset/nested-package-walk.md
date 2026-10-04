---
"@lucent-lang/lucent": patch
---

Build a Lucent package that lives inside the app (a workspace under `packages/`, a `file:` dependency) once, as the package: linked as a dependency it no longer fails with LUCENT3010, and `lucent init` and `lucent bench` no longer count its modules and benchmarks as the app's. An app that imports such a package must list it in its dependencies: `lucent check` and Metro now say so when it does not.

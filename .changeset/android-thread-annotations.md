---
"@lucent-lang/lucent": patch
---

Android thread annotations are followed: `@UiThread` and `@MainThread` classes and methods (a `View`, and every member of it but those marked `@AnyThread`) must be used inside `main(() => …)` (LUCENT3006), and calling a `@WorkerThread` member there warns with the new LUCENT3009, since it blocks. The SDK declarations document both on each member. iOS `@MainActor` properties of classes that aren't main-only are now checked too.

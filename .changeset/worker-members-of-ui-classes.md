---
"@lucent-lang/lucent": patch
---

Stop reporting every call to a `@WorkerThread` method of a `@UiThread` Android class: the method's own annotation now overrides its class's, so it is callable outside `main()` without LUCENT3006.

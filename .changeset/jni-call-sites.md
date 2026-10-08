---
"@lucent-lang/lucent": patch
---

Shorter Android glue: each SDK call site starts with one `LUCENT_JNI_SITE(…)` line for its JNI environment, local frame, class and member, instead of four statements, so the generated C++ for Android calls is about a third shorter.

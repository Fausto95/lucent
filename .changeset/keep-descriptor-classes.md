---
"@lucent-lang/lucent": patch
---

Android release builds with R8 (Expo's default) no longer fail SDK calls with "Java method not found" when a method's parameters name a library class the code never uses directly (Play services' `getCurrentLocation(priority, null)` and its `CancellationToken`): the consumer rules now keep every class in the descriptors the glue looks up.

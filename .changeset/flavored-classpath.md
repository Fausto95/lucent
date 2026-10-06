---
"@lucent-lang/lucent": patch
---

Resolve the Android compile classpath of apps with product flavors (the first debug variant by name, else the release variant) instead of failing Gradle builds with `lucentClasspath` not found.

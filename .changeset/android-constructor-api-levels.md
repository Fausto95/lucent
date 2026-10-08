---
"@lucent-lang/lucent": minor
---

Gate Android constructors by API level: a constructor added after the app's minimum SDK (`api-versions.xml` writes it `&lt;init>`) now needs an `available("android", …)` or `SDK_INT` check (`LUCENT3007`), as methods do; code calling one unchecked no longer compiles.

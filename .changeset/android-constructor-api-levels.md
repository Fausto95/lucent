---
"@lucent-lang/lucent": patch
---

Gate Android constructors by API level: a constructor added after the app's minimum SDK (`api-versions.xml` writes it `&lt;init>`) now needs an `Android.apiLevel` check like methods do.

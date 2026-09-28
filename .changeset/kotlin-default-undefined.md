---
"@lucent-lang/lucent": patch
---

A Kotlin parameter with a default followed by one without (`create(scope = …, produceFile)`) now takes `undefined` on Android, which leaves Kotlin's default in place: `PreferenceDataStoreFactory.INSTANCE.create(undefined, undefined, undefined, () => file)`.

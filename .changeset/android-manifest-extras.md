---
"@lucent-lang/lucent": minor
---

A package's `lucent.json` declares Android `<queries>` (`android.queries`: packages, intents, providers), `<uses-feature>`s (`android.features`) and `<meta-data>` on the app's `<application>` (`android.metaData`, whose value can be an option the app sets, such as an API key). They go into the native package's manifest, which Android merges into the app's.

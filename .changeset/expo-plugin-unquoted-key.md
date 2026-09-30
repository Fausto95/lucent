---
"@lucent-lang/lucent": patch
---

Let `expo prebuild` accept a `react-native.config.js` whose `lucent` entry is written without quotes, as formatters write it, instead of failing and asking for an entry that is already there.

---
"@lucent-lang/lucent": minor
---

Build the native package when autolinking needs it: `lucent init` and the Expo config plugin write `"lucent": require("@lucent-lang/lucent/autolink")(__dirname)` in `react-native.config.js`, which runs `lucent build` when `.lucent/native` is missing or stale, so a fresh clone, CI or EAS no longer builds an app without Lucent. They replace the old `{ root: … }` entry, and `lucent doctor` checks the entry and the Podfile's `use_native_modules!`.

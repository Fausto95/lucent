---
"@lucent-lang/lucent": minor
---

A package can leave values to the app, such as an API key or a usage string: its `lucent.json`'s `options` declares each one, and `{{name}}` in an `Info.plist` value, an entitlement or a manifest component is its value. The app's own `lucent.json` sets them under `packages`, by package. An option without a default that the app doesn't set fails the build, saying how to set it.

---
"@lucent-lang/lucent": patch
---

Bundle Ink and React into the CLI, so `lucent build`, `lucent dev` and `lucent init` work in a terminal whatever React the app installs (an app on React 19.2.0 crashed with "Invalid hook call"); `lucent init` now fails when its prompt ends without answers instead of exiting 0 having changed nothing. The package states `"engines": { "node": ">=22.12" }`, as `lucent doctor` checks.

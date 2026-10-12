---
"@lucent-lang/lucent": patch
---

Build Lucent components on React Native 0.85 and 0.86. Their generated props code called a lookup that only React Native 0.87 and later have, so those releases failed to compile it.

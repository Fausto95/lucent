---
"@lucent-lang/lucent": minor
---

Require an `available("ios", …)` check for iOS C functions, global constants, typed string keys (`NS_TYPED_ENUM`) and enum cases newer than the app's oldest iOS, as for classes and members (`LUCENT3007`); they compiled unchecked and crashed on older devices.

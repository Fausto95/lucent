---
"@lucent-lang/lucent": patch
---

Build again where one platform's SDK is missing (Android on a machine without Xcode) when a module picks a value with `PLATFORM === "ios" ? … : …`: the host build no longer reports LUCENT2001 for the side it cannot type.

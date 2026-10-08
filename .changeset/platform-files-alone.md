---
"@lucent-lang/lucent": minor
---

Split a module with one platform's file only, the other platform getting exports that throw or reject "not available"; share `const`s and enums from a split module's declaration file; and branch on a `const` holding a platform test (`const isIos = PLATFORM === "ios"`) as on the test itself.

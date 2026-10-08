---
"@lucent-lang/lucent": patch
---

Bind Swift members declared `@backDeployed(before: …)` (StoreKit's `Transaction.currentEntitlements`, `AppStore.sync` and others), which were skipped as "type syntax iOS 18".

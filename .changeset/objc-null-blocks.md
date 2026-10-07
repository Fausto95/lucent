---
"@lucent-lang/lucent": patch
---

Pass `null` (or `undefined`) for an Objective-C block the SDK declares optional, such as `UIView.transition`'s completion, instead of the refusal "pass a function".

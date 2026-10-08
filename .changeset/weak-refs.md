---
"@lucent-lang/lucent": minor
---

Break reference cycles with `WeakRef`: a delegate can keep its owner, or a tree node its parent, without keeping it alive, and `deref()` gives `undefined` once the target's last strong reference goes.

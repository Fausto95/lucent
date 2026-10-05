---
"@lucent-lang/lucent": patch
---

Make strings cheaper: each is one allocation, or none up to 15 Latin-1 characters, and short strings compare and hash faster as `Map` keys; `join` allocates once. The `strings` and `wordCount` benchmark kernels run 1.5–1.8x faster.

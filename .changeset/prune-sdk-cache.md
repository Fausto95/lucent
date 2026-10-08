---
"@lucent-lang/lucent": minor
---

Prune the SDK cache: builds remove the entries other Lucent versions wrote once they have gone unused for two weeks (`LUCENT_NO_CACHE_PRUNE=1` keeps them), and `lucent clean --cache --stale` removes them all now, keeping this version's.

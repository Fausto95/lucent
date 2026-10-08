---
"@lucent-lang/lucent": patch
---

Keep locals named like the compiler's temporaries (`obj_2`, `coll0_v`, `pa`, `keys`) apart from them: such a name could make an object point at itself or fail to compile

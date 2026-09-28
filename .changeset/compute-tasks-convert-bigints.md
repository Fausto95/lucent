---
"@lucent-lang/lucent": patch
---

Let compute tasks call `BigInt()`, `BigInt.asIntN`, `BigInt.asUintN`, a bigint's `toString` and `valueOf`, a number's or boolean's `valueOf`, and `toString` on arrays, byte arrays, objects and functions. They were refused with LUCENT3011, although none of them touches module state.

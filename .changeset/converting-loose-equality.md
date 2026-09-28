---
"@lucent-lang/lucent": patch
---

Refuse loose `==` and `!=` where JavaScript converts before comparing, as `LUCENT1002`: a number, string, boolean or bigint against another of them (`1 == "1"`, `true == 1`), or an object against a primitive (`[1] == 1`). Lucent used to compare these like `===` and answer false where JavaScript answers true. Generics are checked once instantiated; `==` between values of one kind, or with `null` or `undefined`, is unchanged.

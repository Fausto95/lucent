---
"@lucent-lang/lucent": patch
---

Compile generics whose signatures put a type parameter in a union (`A | B`, `T | null`) whatever order the type arguments sort in, where the call used to pass the union's members in another order than the generic expects. A type argument that would merge into such a union (an optional, `null` or `undefined`, and in `A | B` a union or a type the union already holds) is now refused with `LUCENT2002` instead of failing to build. `null | undefined` is accepted as a type.

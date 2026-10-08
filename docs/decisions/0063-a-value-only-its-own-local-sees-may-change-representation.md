# 0063. A value only its own local sees may change representation

- **Date:** 2026-10-08
- **Status:** accepted

A local `number[]` of exact integers is an array of integers, and an object literal is a C++ value on the stack, only when nothing but the local's own plans see it: indexing, `push` and `length` for the array, field reads and writes for the object, outside any nested function. No call, return, capture, comparison or conversion meets such a value, which the IR verifier checks, so no other code needs to know its representation. Rejected: passing a stack object to a callee that does not keep it, as a `Ref` with no owner count. The escape facts say the callee does not keep it, but a gap in them (a runtime method that stores its argument) would be a use after free rather than a slower program. _Why:_ the gain comes from the loops that build and read such values; their callers keep the representation every other value has. _Changed:_ [T54](../tasks.md#t54)'s notes.

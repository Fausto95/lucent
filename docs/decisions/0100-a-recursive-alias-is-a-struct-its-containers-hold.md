# 0100. A recursive alias is a struct that its containers hold

- **Date:** 2026-10-13
- **Status:** accepted

A union alias that names itself (`type Json = null | … | Json[] |
{ [key: string]: Json }`) lowers to its union as any alias does, and its
references to itself to a leaf type (`rec`). C++ gets
`struct lucent_app::J_Json`, which derives from the `Opt` or `std::variant`
the union is. Containers hold it (`Array<J_Json>`, `Dict<J_Json>`); a
value anywhere else (a variable, a parameter, a result) is the base type,
so the runtime's overloads for `Opt` and `std::variant` take it as they
take any union. A read from a container (`flat`) gives the base type, and
a write converts back. Generic code that meets the struct itself
(equality, hashing, JSON, `String()`, transport) takes it as its base
through `RecursiveAlias` and `aliasValue` in `core.h`. Conversions, JSON
readers and writers check the stack at each level, as a call does. An alias
with type parameters is refused (LUCENT2002): it has no single native type.

_Why:_ `std::variant` can't hold itself, and a container of an incomplete
type can: `Array<T>` and `Dict<T>` hold their elements behind a pointer.
A struct gives the recursion a name. Keeping values as the base type leaves
the emitter's handling of unions and optionals unchanged, where making
every value the struct would need each runtime overload to see through it.
_Changed:_ [T102](../tasks.md#t102); the C++ type of an element type inside
a container (`cppType(t, nested)`).

# 0044. A read before assignment throws, never crashes

- **Date:** 2026-10-06
- **Status:** accepted

A field,
static field or module variable of an object type (or a union holding
one) that is read before it is assigned throws `TypeError` naming it;
other types keep reading their default. _Why:_ JavaScript gives
`undefined`, which a native `Ref` or struct can't hold without making
every object type optional, and the read used to dereference null. The
pattern (a base constructor reading a subclass's field, a `!` field) is
not reliably detectable at compile time. _Changed:_ the deviations table
in docs/semantics.md, which also records the missing temporal dead zone.

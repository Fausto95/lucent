# 0041. An exported `let` is a live binding

- **Date:** 2026-10-06
- **Status:** accepted

JavaScript reads an
exported `let` through a getter, on the native exports object and on the
proxy, instead of a copy taken at import; an exported `const` is still
copied once. A value the boundary copies (an object, array, map, set,
record, tuple, `Uint8Array`) is copied once per value the module
assigns, the host keeping that copy, so reads are `===` and JavaScript's
changes to it last; the module's changes inside it are not seen, for a
`let` or a `const`. _Why:_ ES modules export bindings, and refusing a
reassigned exported `let` would break existing modules (the e2e case
`modules` exports a counter), while a getter costs one host call per
read. A copy at each read broke identity and dropped JavaScript's
changes; tracking the module's changes inside a copied value would need
a shared object, which the boundary's copy rule excludes. _Changed:_
docs/semantics.md's Modules section.

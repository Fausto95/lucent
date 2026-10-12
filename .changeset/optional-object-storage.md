---
"@lucent-lang/lucent": patch
---

Compile apps whose modules return a promise of an optional object, or hold an optional object or union in an array, map or other storage of its own. Since the previous release, such code failed to compile natively with `field has incomplete type 'std::optional<Opt<…>>'`.

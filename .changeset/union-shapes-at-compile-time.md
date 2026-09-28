---
"@lucent-lang/lucent": patch
---

Reject converting a union of object types to another object type (`LUCENT2003`) when compiling, instead of compiling code that always throws a `TypeError`; each member of a union is now converted on its own, as a subclass to its base class.

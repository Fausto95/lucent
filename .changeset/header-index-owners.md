---
"@lucent-lang/lucent": patch
---

Find the module of CoreFoundation-style enums (`CF_ENUM`, `CF_OPTIONS`, `CF_CLOSED_ENUM`) other modules' signatures name, keep a class with the module declaring it rather than one adding a category to it, and index headers in a fixed order, so the same SDK gives the same bindings on every machine.

---
"@lucent-lang/lucent": patch
---

Faster native rebuilds: each struct, interface and class is defined in a header of its own (`lucent_app_<type>.h`), which only the modules that use it include, so changing a type's fields recompiles its users' C++ instead of every module's, and each module's unit parses only the types it needs.

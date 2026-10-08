---
"@lucent-lang/lucent": patch
---

Faster native rebuilds: adding an object type to one module no longer recompiles the others. An object type without a name is named by its shape in the generated C++ (`S_Object_1a2b3c4d`), and each type is declared in its own header rather than in `lucent_app.h`, which every module includes.

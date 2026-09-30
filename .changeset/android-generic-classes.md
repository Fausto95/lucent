---
"@lucent-lang/lucent": patch
---

Members of generic Java classes are bound: `List<String>.get(0)` reads a string, and a function implements `Consumer<Location>`. Classes declare their type parameters and references keep their type arguments; values of a type parameter cross as SDK objects, strings, numbers or booleans, as the type argument says.

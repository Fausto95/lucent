---
"@lucent-lang/lucent": minor
---

A native extension can wrap a C++ library: with `"language": "c++"` in its `extensions` declaration, the header (`.h`, `.hpp`, `.hh`, `.hxx` or `.h++`) is read as C++20, and each class it defines is a class of `lucent:ext/<name>`. Its public constructors (an overload per default argument left out), member functions and static member functions are callable from Lucent code. Strings, vectors of numbers, booleans or strings, optionals, enums (TypeScript enums with the enumerators' values) and the classes' objects cross, and an object returned by value is a new handle that deletes it once. What C++ throws is an `Error` in Lucent, never unwinding through it. `classes.<Name>.affinity` sets a class's thread. What can't be bound (class templates, classes with a base, abstract classes, other types, overloads TypeScript can't tell apart) is left out and listed with its reason in the extension's declarations.

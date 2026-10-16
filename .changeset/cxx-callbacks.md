---
"@lucent-lang/lucent": minor
---

A C++ extension's member can take a callback: a `std::function` parameter, by value or `const &`, is a function in Lucent, taking numbers, bigints, booleans and strings and returning nothing, a number, a bigint or a boolean. It runs as a C function's callback does (decisions 0126 and 0128), and lives as long as C++ keeps a copy of it; the Lucent function is released on its context when the last copy goes. Two overloads that differ only in their callbacks are left out, with the reason.

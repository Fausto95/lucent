# 0070. 64-bit parameters take safe-integer numbers

- **Date:** 2026-10-08
- **Status:** accepted

A method's or function's own 64-bit integer parameter (a Java `long`, a Swift `Int`) is declared `bigint | number`: a number must be a safe integer, checked where it converts (`RangeError` otherwise, never a rounded value), and a bigint keeps its full range. Results, fields, array elements and callback results stay `bigint`, so values read from native code are exact as before; widening those would make reading a `long` lossy or every result a union. _Changed:_ refines [0008](0008-every-native-64-bit-integer-is-a-bigint.md), for parameters only; [TA37](../tasks.md#ta37).

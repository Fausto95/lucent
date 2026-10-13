---
"@lucent-lang/lucent": minor
---

Support every typed array (`Int8Array` to `BigUint64Array`, `Uint8ClampedArray`, `Float32Array`, `Float64Array`) and `DataView` in module code, where `new Float32Array(n)` failed with LUCENT2002. Typed arrays view an `ArrayBuffer` at any aligned offset and convert what is written as JavaScript does. They have every `%TypedArray%` method but `toLocaleString`, and `ArrayBuffer.isView` works. `Uint8Array` gains the methods it lacked: `at`, `filter`, `sort`, `lastIndexOf`, `reduce` without an initial value and the rest. At the boundary each kind crosses as `Uint8Array` does: copied as its own kind, read in place by a synchronous export that only reads it, and moved when returned whole with nothing else holding it. A `DataView` crosses as a copy.

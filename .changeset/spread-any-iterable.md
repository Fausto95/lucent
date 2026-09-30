---
"@lucent-lang/lucent": patch
---

Spread maps into array literals (`[...map]`, `new Map([...a, ...b])`), and `Uint8Array`s, like the other iterables; spreading a collection into an array of a wider element type (`["start", ...numbers]`) now keeps its elements.

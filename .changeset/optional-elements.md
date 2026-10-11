---
"@lucent-lang/lucent": patch
---

Read elements that may be absent: `xs[i]` and `xs.at(i)` of a `(T | undefined)[]`, `map.get(k)` of a `Map<K, V | undefined>`, and `record[k]` of a `Record<string, V | undefined>` or a `Partial` record now compile, where they wrote C++ that failed to build. A null element stays null, and a missing one reads as undefined.

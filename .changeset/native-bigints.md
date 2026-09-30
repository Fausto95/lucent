---
"@lucent-lang/lucent": minor
---

Native 64-bit integers are bigints: Java's `long` (`long[]` as `bigint[]`), `int64_t`, `uint64_t`, `NSInteger`, `NSUInteger` and Swift's `Int`, `Int64` and `UInt64`, in arguments, results, properties, struct fields, `Out`s, callbacks and constants. Every native value is exact, `NSNotFound` and `Long.MAX_VALUE` included, and a bigint the native type cannot hold throws `RangeError` naming the parameter or field. Enums, option sets and `@IntDef`/`@LongDef` groups stay numbers. Code that passes numbers to these APIs must pass bigints now (`1000n`, `BigInt(n)`), and `Number(list.count)` turns a count or index back into a number.

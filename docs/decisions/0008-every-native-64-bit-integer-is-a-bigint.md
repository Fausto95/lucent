# 0008. Every native 64-bit integer is a `bigint`

- **Date:** 2026-09-25
- **Status:** accepted

Java `long`,
`int64_t`, `uint64_t`, `NSInteger`, `NSUInteger` and Swift `Int`, `Int64`
and `UInt64` cross as `bigint`, exactly; a value the native type cannot
hold throws `RangeError` naming the parameter or field. Enums, option sets
and `@IntDef`/`@LongDef` groups stay numbers. _Why:_ IDs, sizes and
sentinels such as `NSNotFound` and `Long.MAX_VALUE` must never be
narrowed silently through `number`. _Changed:_ added the language's
`bigint` and tasks TB1–TB4; it replaced the earlier rule (exact within
±(2^53 − 1), `RangeError` beyond). Code passing numbers to these APIs must
pass bigints.

---
"@lucent-lang/lucent": minor
---

Swift subscripts are bound: `grid[row, column: col]` is `grid.subscript(row, col)`, and one that can be set also has `setSubscript(row, col, value)`. Static, async and throwing subscripts are bound too, and overloads Swift names alike each get their own shim. A Lucent class implementing a Swift protocol's subscript requirement fails with `LUCENT1005`.

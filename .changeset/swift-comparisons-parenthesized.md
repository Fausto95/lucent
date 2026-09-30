---
"@lucent-lang/lucent": patch
---

Keep the parentheses of a comparison compared again in a SwiftUI body (`a === b === false`): the view's Swift compiles instead of failing on Swift's non-associative comparisons.

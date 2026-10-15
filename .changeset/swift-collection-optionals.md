---
"@lucent-lang/lucent": minor
---

Swift-only members take and give arrays, dictionaries and tuples of optional values and of Objective-C enums: `[Double?]` is `(number | null)[]`, an absent element crossing as `NSNull`, which Swift bridges from and to `nil`, and `[UIView.ContentMode]` is an array of the enum. An optional element of a Swift array or dictionary result now reads as `null` where it read as the element's type before.

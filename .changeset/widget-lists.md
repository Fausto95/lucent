---
"@lucent-lang/lucent": minor
---

A widget's body can show a list of its entry's items with `ForEach` (`<ForEach data={entry.days} id={(d) => d.day}>{(d) => …}</ForEach>`): each item's key and values are computed with the entry's, and its row reads them. A callback in a row is refused, as in the rest of the body.

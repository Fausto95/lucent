---
"@lucent-lang/lucent": minor
---

Support object rest in destructuring: `const { id, ...rest } = user` gives `rest` a new object with the fields its type names, and a record's rest is a new record without the keys the pattern names. It works in declarations, parameters, `for…of` and assignments. A class instance's rest is still `LUCENT1004`.

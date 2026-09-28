---
"@lucent-lang/lucent": patch
---

Store a subclass instance in a union that holds its base class (`const s: Shape | string = new Circle()`), which was rejected with `LUCENT2002`.

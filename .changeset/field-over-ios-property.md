---
"@lucent-lang/lucent": patch
---

iOS: a field of a Lucent class named as its iOS superclass's property (`name = "x"` in a subclass of `Operation`) says why TypeScript refuses it ("is defined as an accessor"): the superclass would never see the field. The fix is to set the property in the constructor (`this.name = …`) or override it with get and set accessors.

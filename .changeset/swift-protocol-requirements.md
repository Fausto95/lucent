---
"@lucent-lang/lucent": minor
---

Lucent classes implement every kind of Swift protocol requirement an object can: properties (read, and set when the requirement allows it), throwing methods (a Lucent error becomes the `NSError` Swift catches), async methods (Swift awaits the Lucent promise), and `mutating` ones. Protocols with associated types are generic in their declarations (`Store<Item>`), and a class fixes them with `implements Store<string>`; `Self` in a requirement is the implementing class. Such protocols' values pass as arguments that name their associated types (`some Store<String>`, from iOS 16). Initializer and static requirements are refused with a diagnostic.

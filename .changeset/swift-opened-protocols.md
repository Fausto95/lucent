---
"@lucent-lang/lucent": minor
---

Members of Swift protocols with associated types can be called on a value typed with them (`s: Store<string>`), on any iOS version: the shim opens the value as the type conforming and casts to and from the associated types. `Self` arguments and results work too. A protocol's `mutating` members and setters now write the value back to the box it came in (before, their shim didn't compile unless the protocol was class-only), and a Swift struct that conforms to a protocol crosses as the protocol's value instead of failing its cast. Static members of such protocols, and members whose closures take or give an associated type, are still refused.

---
"@lucent-lang/lucent": patch
---

Call each Swift initializer that differs from another only by its argument labels: `init(service: String)` and `init(accessGroup: String)` become `Keychain.withService(…)` and `Keychain.withAccessGroup(…)` instead of two `constructor(string)` overloads, where `new Keychain("x")` silently called the first one declared; `new` with such arguments is now an error naming the factories. An unlabeled initializer among them stays the constructor, as Swift calls it. CryptoKit's P256 keys and signatures are made with `withRawRepresentation(…)`, `withX963Representation(…)` and the like.

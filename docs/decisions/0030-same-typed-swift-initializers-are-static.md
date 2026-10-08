# 0030. Same-typed Swift initializers are static factories

- **Date:** 2026-10-04
- **Status:** accepted

Swift
initializers whose parameters' TypeScript types are the same, only their
labels differing (KeychainAccess's `init(service:)` and
`init(accessGroup:)`), are declared as static factories named after their
labels (`withService`, `withAccessGroup`), not as `constructor`
overloads, but for one whose arguments have no labels, which stays the
constructor as Swift calls it with bare arguments; `new` with the others'
arguments is an error naming them. _Why:_
TypeScript resolves identical overloads to the first one declared, so
`new Keychain("x")` silently called `init(accessGroup:)`, found binding
the package in the bare example (TA32). _Changed:_ the iOS declarations
of such classes (CryptoKit's P256 keys and signatures, whose
representations are factories now, `withRawRepresentation`); Objective-C
initializers are not separated yet.

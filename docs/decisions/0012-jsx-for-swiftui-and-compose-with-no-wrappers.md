# 0012. JSX for SwiftUI and Compose, with no wrappers

- **Date:** 2026-09-29
- **Status:** accepted

A
component's body is the JSX it returns, found by type; there is no
`swiftUI()`, `compose()` or `native()` wrapper. Compose's composition
calls stay ordinary statements, which the compiler moves into the
composable. SwiftUI modifiers are attributes in source order, with a
trailing chain for repeats; an attribute named like an initializer label
is an argument. Imports target one platform's toolkit; there is no common
interface. _Why:_ the wrappers were ceremony: removing `native()` showed
it did nothing a direct construction does not. _Changed:_ this replaced the 2026-09-26 call-form
syntax; `native()` was removed.

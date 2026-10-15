# 0113. A Swift subscript is the methods `subscript` and `setSubscript`

- **Date:** 2026-10-15
- **Status:** accepted

A Swift subscript, an instance's or a type's, is a method named
`subscript` taking its parameters. One that can be set (`{ get set }`)
also has `setSubscript`, taking them and then the new value. Overloads
are `subscript` overloads, told apart by their types. The shim reads
`self[row, column: col]` and writes `self[row, column: col] = v`, with
the labels the subscript's name gives. An async or throwing subscript
gives a promise or throws, as a getter does. A Lucent class can't
implement a subscript requirement of a protocol (`LUCENT1005`).

_Why:_ TypeScript's index signatures take one key and run no code, so
they can't stand for a subscript with labels or several parameters.
Kotlin's `operator get` and `set`, and Objective-C's
`objectAtIndexedSubscript:`, are already methods. Naming Swift's `get`
and `set` would clash with Swift methods of those names, and `subscript`
is the word Swift's documentation uses.
_Changed:_ [T112](../tasks.md#t112), bindgen's `swift.ts` and
`SwiftMember.subscript`, `emit/swift.ts`, `emit/swift-proxy.ts`, codegen's
`swift/ast.ts` (`subscript`).

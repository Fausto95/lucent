# 0010. SwiftUI and Compose are written in Lucent

- **Date:** 2026-09-26
- **Status:** accepted

Views have no
per-platform native code to write. SwiftUI and Compose are bound as they
are (`lucent:swiftui`, `lucent:compose`); bodies become generated SwiftUI
and `@Composable` source; logic stays C++ behind the Swift and Kotlin
shims; signals map to the toolkits' observable state; animations use each
platform's own APIs from TypeScript. There is no cross-platform view
vocabulary. _Why:_ the goal is no per-platform native code for the
author to write, and, without a shared vocabulary, each toolkit is written
the way its vendor documents it. _Changed:_ this overrides the design's
section 16.8 ("Lucent does not translate SwiftUI or Compose bodies").
T57 and T58 became the host layers (containment, lifecycle, sizing,
disposal) for generated content instead of factory hosts. The first
syntax, a call form inside `swiftUI(() => …)` and `compose(() => {…})`,
was replaced on 2026-09-29.

---
"@lucent-lang/lucent": minor
---

A widget's body can show its entry's dates, as SwiftUI's own members taking a `Date` do (`<Text date={entry.date} style={Text.DateStyle.relative} />`): lucent:swiftui now declares them, and a date crosses into the widget's Swift as its seconds since 1970. A component's body still shows no `Date`, and `LUCENT3024` now says so. SDK schemas read `Date` and `Data` where swift-foundation declares them (`FoundationEssentials`), as Swift toolchains off Darwin do.

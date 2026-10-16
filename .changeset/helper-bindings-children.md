---
"@lucent-lang/lucent": minor
---

A SwiftUI or Compose helper view may take bound signals and children. A bound prop (`on: Bound<boolean>`) is a Swift `Binding`, or a Kotlin value and its change callback (`on`, `onChanged`): its user gives it `bind(signal)` or a bound prop of its own, and `<Toggle isOn={props.on}>` shows and changes it. Children (`children: Content`, `Shown` in Compose) are a content closure of the helper's view: its user's element holds them, and `{props.children}` shows them. lucent:swiftui's `Content` nests to any depth, so a helper's children may sit among other views.

---
"@lucent-lang/lucent": minor
---

A SwiftUI or Compose helper view may take its toolkit's values: `function Swatch(props: { tint: Color; modifier?: Modifier })`. Each is a parameter of the toolkit's type in the helper's Swift view or Kotlin composable, and its user writes the value where it draws (`<Swatch tint={on ? Color.red : Color.blue} />`). An optional one is `nil` or `null` when left out, and `props.modifier ?? Modifier` defaults it. A helper's other props are still plain data and callbacks of scalars.

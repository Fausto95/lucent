---
"@lucent-lang/lucent": minor
---

A SwiftUI or Compose helper view may destructure its props: `function Row({ title, done: isDone }: RowProps)`. Each name reads the prop it names, as `props.title` does, whatever it holds: plain data, a callback, a toolkit's value, a bound signal or its children. A default, `...` or a nested pattern is LUCENT3024.

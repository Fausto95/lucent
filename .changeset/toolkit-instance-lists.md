---
"@lucent-lang/lucent": minor
---

A SwiftUI or Compose body's list may show instances (`<list.items items={props.players} key={(p) => p.title}>`). The items stay in C++: each item's values are computed from its instance, and a callback passing the item to a setup function (`() => pick(p)`) gives it the instance, found again by its key. What an item's values call is checked as setup code is (LUCENT3022).

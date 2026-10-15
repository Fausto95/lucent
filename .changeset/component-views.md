---
"@lucent-lang/lucent": minor
---

A module function can take a component's view: a parameter typed `ComponentView` from `lucent:ui` takes the component's ref (`ref.current`), and `viewOf` from `lucent:ios` or `lucent:android` gives the view its setup returned, as a `UIView` or an Android `View`, inside `main()`. Once the component unmounts, `viewOf` throws an `InvalidStateError`. A value that isn't a component's ref is a TypeError, and a `ComponentView` can't go back to JavaScript (LUCENT2006).

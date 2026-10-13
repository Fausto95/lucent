---
"@lucent-lang/lucent": minor
---

A component takes React Native's view props, typed as `ViewProps`: `testID`, `accessibilityLabel`, `onLayout` and the rest reach its host view as they reach a `View`. A prop or event of the component's own takes the place of the view prop of its name. Its ref has the host view's `measure` and `measureInWindow` beside its commands, and a command with either name fails with LUCENT3021. A request takes `{ signal }` after its arguments: aborting it rejects the request with the signal's reason. An app that typed a component's ref by hand needs the two new methods in that type, or `ComponentRef<typeof Component>`.

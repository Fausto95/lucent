---
"@lucent-lang/lucent": minor
---

A widget's `body` in `ios.appExtensions` (an exported function of an iOS JSX file, `(entry: E) => View`) is no longer compiled as a component or a module function. The widget's build compiles it into a C++ function of its entry that computes each value its SwiftUI view shows, and writes the view, which reads them, to `widgets/<name>.swift`. A callback, a binding, a signal or a list (`ForEach`) in it fails with `LUCENT3024`: WidgetKit draws a widget once per entry. A body that isn't such a function fails with `LUCENT3019`. An app extension's build no longer compiles the components of the modules its code reaches.

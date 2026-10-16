---
"@lucent-lang/lucent": minor
---

An iOS widget (`kind: "widget"` in `ios.appExtensions`) now builds: its `provider` class's `placeholder()`, `snapshot()` and `timeline()` give WidgetKit its entries, each drawn by its `body`. The widget's build writes the Swift WidgetKit takes (the entry, a `TimelineProvider` and the `Widget`, with lucent.json's `displayName`, `description` and `families`) and C glue running each method on its module's actor. The Expo plugin and `lucent init` add the widget's target, whose one source is its `@main` bundle. A provider whose methods don't mirror `TimelineProvider`'s for the body's entry fails with `LUCENT3019`. A failed `snapshot()` gives WidgetKit the placeholder's entry, and a failed `timeline()` that entry until WidgetKit asks again, in 15 minutes.

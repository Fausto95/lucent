---
"@lucent-lang/lucent": patch
---

In an Expo app, a background fetch reaches the modules that listen for `onAppEvent("backgroundFetch")`: Lucent's subscriber to Expo's app delegate now forwards `application(_:performFetchWithCompletionHandler:)` too. The iOS simulator delivers a simulated silent push this way.

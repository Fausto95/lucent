---
"@lucent-lang/lucent": patch
---

Blocks the iOS SDK passes to Lucent code become functions: a completion handler given to a Lucent function (`coordinator.prepare(…, (done) => done())`) or to a Lucent class's protocol method (`URLSessionTaskDelegate`'s `completionHandler`) can be called like any function. Blocks taking CoreFoundation values (`CFArrayRef`, `CFErrorRef`) are supported too. Protocol requirements are declared in their completion-handler form only, so Lucent classes can implement them; before, the promise form merged in as an overload made that a type error.

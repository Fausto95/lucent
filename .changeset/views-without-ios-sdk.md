---
"@lucent-lang/lucent": patch
---

Build a component that makes UIKit's and Android's own views in one file (its iOS branch returning a `UILabel`, its Android code a `TextView`) for the platforms whose SDK is installed: without Xcode, its Android build failed with LUCENT2001, since the missing SDK's view is untyped. With both SDKs, each platform's setup now returns that platform's view, where its C++ returned a variant of both and did not compile.

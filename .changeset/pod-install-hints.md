---
"@lucent-lang/lucent": patch
---

Ask for `pod install` before rebuilding whenever iOS relinks, including when a Lucent package's pod requirement changes. Give an SDK module that was not found its own fix, and stop reporting it as a cached binding.

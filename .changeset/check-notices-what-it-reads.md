---
"@lucent-lang/lucent": patch
---

Check again when something a check read changes, instead of answering "unchanged since the last check" or "Up to date": a dependency's `package.json` (an `exports` map that drops a deep import now fails the check), a file a module imports types from, a library's renamed `package.json`, or the app's Android classpath.

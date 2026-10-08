---
"@lucent-lang/lucent": patch
---

An async result or a callback argument that cannot be converted to JavaScript now rejects the promise (or is reported) whatever it throws, instead of crashing the app when the error was not a JavaScript one.

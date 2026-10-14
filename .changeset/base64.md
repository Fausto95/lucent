---
"@lucent-lang/lucent": minor
---

Support `atob` and `btoa`, by HTML's forgiving base64. Where JavaScript throws a `DOMException`, Lucent throws an `Error` of the same name, `InvalidCharacterError`, with Node's messages.

---
"@lucent-lang/lucent": patch
---

Call Swift APIs that take a Foundation value type, such as `URLSession.shared.data(request)` (a `URLRequest`) or `data(url)` (a `URL`), with the object Lucent code has (`NSMutableURLRequest`, `NSURL`), instead of generating Swift that does not compile.

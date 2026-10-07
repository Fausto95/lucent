---
"@lucent-lang/lucent": patch
---

Await Swift async methods whose result is a tuple, such as `URLSession.shared.data(request)`, instead of crashing the compiler; a Swift member whose tuple holds a collection or a closure is left out with its reason, as other unsupported members are.

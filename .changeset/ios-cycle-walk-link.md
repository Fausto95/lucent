---
"@lucent-lang/lucent": patch
---

Link iOS apps whose Lucent code has closures that capture objects. Since the reference-cycle report, such builds failed on iOS with a duplicate symbol, `thread-local initialization routine for lucent::debug::detail::closuresInWalk`.

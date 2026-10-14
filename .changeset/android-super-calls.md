---
"@lucent-lang/lucent": minor
---

A Lucent class extending an Android class calls the base's implementation with `super.onCreate(saved)`, as a `Fragment`, a `Service` or an `Activity` requires, and its overrides run while Android waits, whatever they return. Before, one returning nothing ran later on its package's thread, so Android found it not done: a `Fragment` threw `SuperNotCalledException`.

---
"@lucent-lang/lucent": patch
---

Build `new Box(1)` as the `Box<number | undefined>` it becomes (an array literal mixing it with `new Box<number | undefined>(undefined)`, an argument, a return), where it emitted C++ that failed to compile; an existing `Box<number>` used as a `Box<number | undefined>` is refused with `LUCENT2004`. `JSON.stringify` calls a class's `toJSON` function field, as JavaScript calls an own `toJSON` property

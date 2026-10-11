---
"@lucent-lang/lucent": minor
---

An object literal now stands for an interface that classes implement, when the interface has only properties and no type parameters: `const p: Point = { x: 1, y: 2 }` compiles beside `new Pixel(3, 4)` as a `Point`. The literal is one object with JavaScript's identity and mutation, `JSON.stringify` writes its properties, and JavaScript receives it as a plain object. A literal for an interface with a method, or a generic one, reports `LUCENT2008` naming why.

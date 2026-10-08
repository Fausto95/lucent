---
"@lucent-lang/lucent": minor
---

Keep SDK objects in exported classes: a private field, method or accessor that uses one platform's SDK belongs to that platform, and the class stays usable from JavaScript on both, so `export class Player { private player: AVPlayer | null }` compiles instead of failing with `LUCENT3004`.

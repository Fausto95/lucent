---
"@lucent-lang/lucent": patch
---

LUCENT3022 checks what a SwiftUI or Compose body's values call. What the setup computes for a body runs on the main thread: each value the body shows that reads the setup's names, what a helper view computes where it is used, and what a callback passes. A value calling a module function that reads module state code off the main thread writes was let through before; it is refused now, as it is in setup code.

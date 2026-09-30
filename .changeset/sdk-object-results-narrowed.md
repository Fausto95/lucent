---
"@lucent-lang/lucent": patch
---

Declare Java buffers as their superclass: `java.nio.Buffer` no longer declares `array()`, whose `Object` result `ByteBuffer`, `IntBuffer` and the others narrow to typed arrays. TypeScript rejected those overrides, and with them each buffer as a `Buffer`. Coverage lists the left-out member with its reason.

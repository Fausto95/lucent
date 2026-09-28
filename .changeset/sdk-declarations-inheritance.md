---
"@lucent-lang/lucent": patch
---

Type SDK classes as their platforms do: a subclass keeps the overloads it inherits (`ByteBuffer.limit()` beside `limit(int)`), an override keeps the non-null result and constants of the method it overrides, and iOS classes no longer repeat their superclass's protocols, so the generated declarations type-check with far fewer errors.

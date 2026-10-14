---
"@lucent-lang/lucent": minor
---

Support `TextEncoder` and `TextDecoder` for UTF-8, as the Encoding standard defines them: `encode`, `encodeInto`, and `decode` with `fatal`, `ignoreBOM` and `stream`. A `TextDecoder` label naming another encoding is refused (`LUCENT1003`), or a `RangeError` when computed. `lucent:core`'s `utf8Decode` now decodes as `TextDecoder` does with `ignoreBOM`: one U+FFFD for each invalid sequence, where it sometimes gave several.

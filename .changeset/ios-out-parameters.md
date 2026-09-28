---
"@lucent-lang/lucent": patch
---

iOS methods that write through pointers to numbers, enums, structs, strings, dates and objects are bound: pass an `Out<T>` from `lucent:ios` and read its `value` after the call (`color.getRed(red, green, blue, alpha)`, `calendar.range(.day, start, interval, date)`, a `PropertyListSerialization` format, an `NSRange` effective range). `value` is writable, for pointers the method also reads. Throwing methods that return `id` no longer fail to compile in `-Werror` builds.

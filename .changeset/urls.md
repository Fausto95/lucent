---
"@lucent-lang/lucent": minor
---

Support `URL` and `URLSearchParams`, by the URL standard, with Ada (the parser Node uses) vendored in the runtime: every part of a URL read and written, `URL.canParse` and `URL.parse`, a `searchParams` linked to its URL, and `URLSearchParams`' methods and iterators. A native package carries the parser only when the program makes a URL.

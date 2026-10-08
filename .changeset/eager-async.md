---
"@lucent-lang/lucent": patch
---

An async function that never awaits compiles to a plain function that returns its settled promise, with no coroutine frame to allocate; what awaits it still resumes later, as in JavaScript. Function values allocate once instead of twice.

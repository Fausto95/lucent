---
"@lucent-lang/lucent": patch
---

Compute tasks read module constants safely across a JavaScript reload. A reload runs each module's initialization again, which assigned constants while a task could still read them (a string or function constant could be freed under the task). Code now reads number, string, boolean and bigint literal constants, and static readonly fields holding one, as their literals; a task that reads any other module constant is refused with LUCENT3011, with the path to it: make it a literal or pass its value in the task's input.

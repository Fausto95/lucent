---
"@lucent-lang/lucent": minor
---

Add `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` and `queueMicrotask` to module code, where they weren't declared. A timer runs its function as a turn of the context that started it (the module's actor, the main thread or an executor), timers due together run in the order they were started, and `queueMicrotask` runs after the current code with the context's other microtasks. A reload clears the timers a module left running.

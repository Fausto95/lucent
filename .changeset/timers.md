---
"@lucent-lang/lucent": minor
---

Add `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` and `queueMicrotask` to module code, where they weren't declared. A timer runs its function as a turn of the context that started it (the module's actor, the main thread or an executor), timers due together run in the order they were started, and `queueMicrotask` runs after the current code with the context's other microtasks. A reload clears the timers a module left running.

Microtasks that a call from JavaScript queues now run before a job queued on the module's actor while that call ran, such as a timer due at once: microtasks before the next task, as in JavaScript.

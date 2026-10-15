---
"@lucent-lang/lucent": patch
---

On Android, a view a component makes after setup takes the hosting view's themed context, as setup's views do: an update and a command run inside the shell's entry, and a callback the setup made takes its root view's context. Such views got `appContext()`, the Application's, before.

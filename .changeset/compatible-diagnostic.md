---
"@lucent-lang/lucent": minor
---

Report a Lucent package whose `lucent.compatible` range leaves out the running Lucent as LUCENT3014 at its `package.json`, in builds, checks and the editor, instead of stopping with a bare error; `LUCENT_IGNORE_COMPATIBLE=1` compiles it anyway with a warning. The example packages state caret ranges (`^0.2.0`).

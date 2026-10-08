---
"@lucent-lang/lucent": minor
---

Add JS dev mode, a development-only Metro option (`withLucent(config, { js: true })` or `LUCENT_JS=1`) that runs `*.lucent.ts` modules as JavaScript, so edits refresh without a native rebuild; platform SDK calls throw `LUCENT_JS_DEV_NATIVE`, components stay native, and release bundles refuse it.

---
"@lucent-lang/lucent": minor
---

A module's web twin, `name.web.lucent.ts`, is plain TypeScript for the web (decision 0133): native builds leave it out, and `lucent build`, `lucent check` and the editor type-check it with the DOM's types against the module's exports, reporting LUCENT3005 at the twin when it doesn't export what the module does, with the same types. `lucent:platform`'s `PLATFORM` is typed `"ios" | "android" | "web"`.

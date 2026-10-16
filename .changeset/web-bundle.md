---
"@lucent-lang/lucent": minor
---

Lucent modules run in React Native Web builds (decision 0133): for the `web` platform, Metro bundles each `*.lucent.ts` module as its JavaScript, release bundles included, with `lucent:core`'s and `lucent:thread`'s JavaScript and `PLATFORM` `"web"`, and `withLucent`'s resolver puts a module's `*.web.lucent.ts` twin in its place. Without a twin, a platform module or a module importing a platform's modules fails the web build, naming its platform files or the import's line; so do a `.lucent.tsx` module and a `lucent:views/*` import, whose views are native.

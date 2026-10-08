# 0060. JS dev mode runs modules as JavaScript

- **Date:** 2026-10-08
- **Status:** accepted

An opt-in Metro mode (`withLucent(config, { js: true })` or `LUCENT_JS=1`) bundles each `*.lucent.ts` module as the JavaScript it is, with lucent:core's JavaScript implementation, `PLATFORM` as the running platform and a split module's platform file; platform SDK, extension and toolkit imports are stand-ins that throw `LUCENT_JS_DEV_NATIVE` when used, and `.lucent.tsx` modules stay native. A release bundle (`dev: false`) refuses it. _Why:_ a body edit needed a native rebuild, and Lucent's contract is JavaScript's semantics, so a module's logic runs the same as JavaScript. Routing SDK calls to the last native build was rejected: the native module's exports are the module's, not its SDK calls, so there is nothing to route a single call to, and mixing JavaScript state with native state would run neither faithfully. _Changed:_ the watcher keeps building natively in the mode, so diagnostics and the RedBox still report what native code refuses.

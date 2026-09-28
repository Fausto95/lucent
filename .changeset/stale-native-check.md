---
"@lucent-lang/lucent": patch
---

Proxies check the app's native code before a module loads. An app built before this check, with another runtime ABI, without the module, or with another API for it, throws an error that names what to do: rebuild and reinstall the app (`compile-native`), or reload JavaScript built for the installed app (`reload-js`). When only function bodies differ, a warning says the installed implementation runs, once per reload. JavaScript-only edits change nothing.

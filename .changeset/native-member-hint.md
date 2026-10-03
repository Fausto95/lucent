---
"@lucent-lang/lucent": patch
---

Say what to do when a native library's type has no member the code uses: the error names the module and the installed version (`pod:Name@version`) that declare the type, after a library update removed or renamed it. On iOS, for a type only named in another module's signatures, it says to import its module.

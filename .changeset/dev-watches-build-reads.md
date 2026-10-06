---
"@lucent-lang/lucent": patch
---

Rebuild in `lucent dev` when a file the last build read changes, such as a `.ts` file a module imports types from or a declaration in `node_modules`. Check again when a linked package is replaced by an installed copy whose re-exported files differ.

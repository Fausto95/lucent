---
"@lucent-lang/lucent": minor
---

Have `lucent init` add the editor plugin to `tsconfig.json` and write `.vscode/settings.json` so VS Code uses the workspace's TypeScript, which loads it; `lucent build`'s one-time `lucent:*` path edit to `tsconfig.json` is now a warning naming the entry it added.

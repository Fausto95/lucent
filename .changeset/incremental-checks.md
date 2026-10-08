---
"@lucent-lang/lucent": patch
---

Check faster after an edit in the editor and in `lucent dev`: each check reuses the last one's TypeScript programs, so only the files that changed are parsed and checked again, and the process no longer keeps every declaration file it ever parsed.

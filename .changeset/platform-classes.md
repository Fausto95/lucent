---
"@lucent-lang/lucent": minor
---

Platform files can share a class: the declaration file says `export declare class Player { … }`, and each platform file exports a `Player` with the declared members in the same forms and no other public ones (`LUCENT3005` otherwise). Shared code and JavaScript use the platform's class; on a target without the platform's file, its construction and members throw, or reject, "not available".

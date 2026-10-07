---
"@lucent-lang/lucent": patch
---

Make `lucent sdk coverage` count as builds do: members are judged with the types other modules declare, Swift's `Hashable`, `Equatable` and `Codable` plumbing is left out of the share (`plumbing` in `--json`), each report records the SDK it was read from (`sdk`), and a `--android 'p.*'` prefix that matches no package fails instead of gating nothing.

# 0035. SDK declarations say what the compiler checks

- **Date:** 2026-10-06
- **Status:** accepted

A
generated declaration's thread line comes from the predicate LUCENT3006
uses (`mainThreadOnly`), so an async Swift member of a main-actor class is
documented as callable from any thread; `sdk show` and `sdk search` read
the toolkit modules (`lucent:swiftui`, `lucent:compose`) through the same
function the compiler serves them with, and only with views on, saying so
otherwise. _Why:_ the docs and the CLI disagreed with what compiled.
_Changed:_ nothing planned; T61's SDK workflow item builds on it.

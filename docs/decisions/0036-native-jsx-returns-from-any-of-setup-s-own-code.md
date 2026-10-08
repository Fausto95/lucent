# 0036. Native JSX returns from any of setup's own code

- **Date:** 2026-10-06
- **Status:** accepted

A
component returns its platform views' JSX from its last statement, a
PLATFORM branch or guard, a ternary's arms, or any condition of setup's
(`if (available("ios", 17)) return <… />`), and makes its slot at the
top level of setup or of a PLATFORM branch (an `if` testing the platform
alone, or a case of `switch (PLATFORM)`; the host's program takes one
slot per branch). One platform's branch may return a toolkit's body and
the other native views. JSX kept in a variable or made by a function of
setup's is still refused (LUCENT3025), and so is a slot under a PLATFORM
test with another condition (`PLATFORM === "ios" && ready`), which runs
only when the condition holds (LUCENT3021). _Why:_ the
last-statement rule came from toolkit bodies, which compile to one
Swift or Kotlin body; native JSX is setup code run once per mount, so a
return under a branch is ordinary JavaScript, and each platform's
program lowers only its own branch. The rule made one-file components
with platform views or children impossible, though one file with
PLATFORM branches is how a component is written (2026-09-30), and left
LUCENT3007's advice, `if (available(…))`, unusable for an attribute.
_Changed:_ T48's diagnostics, views.md (Platform views as JSX:
where it is returned; Children: the slot rule).

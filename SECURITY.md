# Security policy

## Supported versions

Lucent is in preview (0.x). Fixes land in the latest release of
`@lucent-lang/lucent` only; upgrade to it before reporting.

## Reporting a vulnerability

Report it privately, not in a public issue:

- through GitHub's [private vulnerability reporting](https://github.com/Fausto95/lucent/security/advisories/new), or
- by email to the maintainer at faustino.kialungila@gmail.com, with
  "Lucent security" in the subject.

Say what is affected (the CLI, the compiler's output, the C++ runtime, the
Metro or Expo integration), the version, and how to reproduce it. You'll
get an answer within a week. Once a fix is released, the advisory credits
you unless you'd rather it didn't.

What counts: code Lucent generates or ships that a malicious input could
make unsafe in an app (memory safety in the runtime or generated C++, a
JSI object crossing threads), the CLI running or fetching something it
shouldn't, or a compromised release.

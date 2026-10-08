# 0001. Improvement plan

- **Date:** 2026-09-23
- **Status:** accepted

One reflection-based `NativeProxy` for
every Java interface, measured before generating classes; single-file
platform branches as the standard way to write platform code; packages
ship sources only; SDK member names come only from the member's own
signature. Bind the types apps commonly use, not every type: the "under
1% unrepresentable" target was dropped, and the coverage report is a
regression check that CI enforces.

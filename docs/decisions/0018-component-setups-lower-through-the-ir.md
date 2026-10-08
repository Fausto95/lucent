# 0018. Component setups lower through the IR

- **Date:** 2026-10-02
- **Status:** accepted

A setup is
lowered as functions are, its mount an ambient value of the IR that the
functions it makes capture and enter (`closure.enters`), and a toolkit
body's slots thunks: closures of each slot's expression, which the
effects the toolkit code writes call. _Why:_ the setup's code is the
program's, so it gets the IR's order, captures and verification; the
toolkit glue keeps only what no TypeScript expression says (the host,
the effects, the encoding). _Changed:_ the emitter's statement lowering,
its lambdas over the setup's locals and its own evaluation-order helpers
are removed: the IR orders evaluation, and leaves are expressions.

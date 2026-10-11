# 0073. Every call checks the stack, in Release builds too

- **Date:** 2026-10-11
- **Status:** accepted

Each Lucent function that runs code of the program checks, on entry, that
its thread's stack has more than a margin left (64 KB, or a quarter of a
small thread's stack), and throws JavaScript's `RangeError: Maximum call
stack size exceeded` when it has not, in Debug and Release builds alike. A
function that runs none of the program's code (no call, plan, iteration or
disposal: arithmetic, a comparator) skips it, since it cannot recurse. A
build may define `LUCENT_NO_STACK_CHECK` to compile the check out. _Why:_
recursion without end ended the app, where JavaScript throws, and the
check costs nothing measurable on P2's kernels on the host (each kernel
call checks once; sortNumbers' comparator is a leaf), so it meets
TA42's 1% bar. Its worst case, a recursive function whose whole body is
one addition (`fib`), runs about 25% slower on the host (0.4 ns a call:
a thread-local load and a compare); JavaScript engines pay the same check.
On devices the thread-local load is a call on iOS and, below API 29, on
Android (emulated TLS): T65's device runs measure it, and this decision is
revisited if P2 misses its budgets there. _Changed:_ [TA42](../tasks.md#ta42).

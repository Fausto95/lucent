# 0082. Objects go on an executor where they are made and keep `this` in

- **Date:** 2026-10-13
- **Status:** accepted

Refines
[0078](0078-executors-are-wrapped-where-code-is-handed-to-the-platform.md)
for objects, as
[0081](0081-functions-on-an-executor-share-only-constants-and-channels.md)
did for functions. An object goes on an executor where it is made and
handed to the platform: `on(executor, new C(…))`, as an SDK call's
argument or the value assigned to an SDK property, as in
`parser.delegate = on(frames, new Collector(out))`. A class made so is
an executor class: every `new C` in the program must be such an `on()`,
it may not be exported, extend a class or be extended, and `this` in its
members may only be a member access's receiver. So no code but the
platform's calls ever holds one of its objects, and its fields are the
executor's without further checks. What its constructor is given is
shared with the code that makes it, so it takes only numbers, strings,
booleans, bigints, `null` and `undefined`, channels and executors, as a
function's captures do. Its methods and accessors are executor code,
checked as `on()`'s functions are: no module state, computed constants,
main-thread native code, unknown code or asynchronous work, and native
code of unknown thread allowed. The object keeps its executor in a
hidden field, set before the platform has it, and the glue the platform
calls (an Objective-C delegate, a Swift proxy, a Java proxy) enters that
executor: a method that answers nothing runs at once on the executor, or
as a turn of it from another thread, and one that answers runs now, a
call from another thread being reported. Code an executor may run hands
the platform its own objects with `on()` too. _Why:_ a class that names
its executor would tie it to one, and tracking each instance's owner
through the program is a larger analysis than the rule needs: making the
object at the hand-off and keeping `this` in leaves nothing else to
track. _Changed:_ [T109](../tasks.md#t109).

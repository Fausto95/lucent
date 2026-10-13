# 0098. An instance prop is held from its commit, and checked member by member

- **Date:** 2026-10-13
- **Status:** accepted

Amends [0075](0075-instances-of-exported-classes-as-view-props.md) in
three ways.

An instance prop travels as a number, its runtime's id times 2^32 plus the
instance's number there (`rn/LucentViewInstances.h`). The ids hold
nothing. The commit's props find the instance as React Native parses
them, in the JavaScript call that commits, and hold it; the mount holds it
while it shows it. 0075 had the mount find it on the main thread at
commit.

A view's code is its setup, the functions it makes (but `main()`
callbacks, which hold the module's lock), and what they call. It runs on
the main thread without the lock. Code off the main thread is any unit
something other than the main thread runs, and JavaScript's own uses of a
public field: it reads one, and writes one that is not `readonly`. A
member both use, one of them writing it, is refused where the view uses
it (LUCENT3022), naming both uses. A class's construction is no use: it
runs before its instance can reach a view. A use of a member holding an
array, a collection, a library object or a plain object counts as a
write, since it may change what the member holds.

The classes checked are those a view's props take, their bases and
subclasses, and the classes their members hold or their methods return,
in turn. A SwiftUI or Compose body takes no instance prop until
[T123](../tasks.md#t123). A component's React types import an instance's
class from `lucent:module/<module>`, which `lucent build` writes as its
module's own exports.

_Why:_ by the time the main thread mounts a commit, JavaScript may have
let the instance go, and weak ids would find nothing; held from the
commit, it lives exactly as long as some commit or mount has it. Every
public method is JavaScript's to call on the module's thread, so the
members a view may use without a race are the ones `main()` callbacks
alone touch, or that nothing writes once made: the rule says so member by
member, as main-state.ts says it for module variables. _Changed:_
[T120](../tasks.md#t120).

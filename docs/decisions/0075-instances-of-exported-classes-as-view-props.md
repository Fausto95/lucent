# 0075. A view prop may be an instance of an exported class

- **Date:** 2026-10-12
- **Status:** accepted

Supersedes the refusal of class instances as view props in
[0046](0046-ports-keep-their-apis-views-share-state-the-main.md) and
[0065](0065-platform-members-not-platform-classes.md). A component's prop
may be an instance, an optional instance or an array of instances of an
exported class (`<VideoView player={player} />`): it crosses Fabric as the
instance's id in its host, the mount resolves it on the main thread and
holds the instance while it shows it, and the instance lives until the
last of its JavaScript object, the mount and Lucent code lets it go. The
rule that makes a module variable only main-thread code uses the main
thread's extends to an instance's members: a member only `main()`
callbacks, setups and the methods a view calls touch is the main
thread's, read and written there without the Lucent lock; a member module
code also touches is refused where a view uses it, with a diagnostic naming
the member and both uses. Classes stay shared, as 0065 has them, and the
main context still never waits behind module code, as 0046 has it.
_Why:_ react-native-video 7 hands its `VideoPlayer` to the view, VisionCamera
5 passes `previewOutput` and gesture controllers as view props, and
expo-video's `VideoView` takes `player`; an id in a map only main-thread code
touches is what Expo does underneath, not what authors write, and it left
the lifetime to the author, which JavaScript could not end. The race 0065
named (a view calling an instance's methods while module code uses its
fields) is refused at compile time instead. _Changed:_ [T71](../tasks.md#t71).

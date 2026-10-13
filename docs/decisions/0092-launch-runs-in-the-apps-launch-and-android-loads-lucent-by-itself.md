# 0092. Launch modules run in the app's launch, and Android loads Lucent by itself

- **Date:** 2026-10-13
- **Status:** accepted

The third decision [T130](../tasks.md#t130) needs. `lucent.json`'s
`launch` lists modules to create at app launch, and their creation starts
module state ([0090](0090-module-state-resets-only-when-nothing-native-holds-it.md)),
holding it for the process. On iOS it runs in
`LucentAppDelegate`'s `application(_:didFinishLaunchingWithOptions:)`,
which a bare app's delegate calls first ([T110](../tasks.md#t110)) and an
Expo app's subscriber calls, before the delegate returns, as
`BGTaskScheduler` requires. `lucent build` names a missing call for an
app with `launch` modules. On Android it runs in `LucentInitializer`, the
content provider that starts before `Application.onCreate`.

On Android, Lucent's C++ becomes a shared library of its own,
`liblucent.so`, which `appmodules` links instead of compiling it in. The
initializer loads it with `System.loadLibrary("lucent")`, and so does
every Java class Lucent generates that the OS may start in a cold process
(a `Worker`, a `Service`), before its first native call. Its
`JNI_OnLoad` initializes fbjni and registers Lucent's natives. React
Native's libraries load as its dependencies. Their own `JNI_OnLoad` runs
when React Native later loads them through SoLoader, which finds them
loaded.

_Why:_ iOS takes `BGTaskScheduler` registrations only until launch ends,
and Android's notification channels and WorkManager setup belong before
any Activity. A content provider is the one place a library runs before
`Application.onCreate` without a line in the app. Compiled into
`appmodules`, Lucent's code loads only when React Native loads it, which a
`Worker` started in a cold process may never do. A library of its own can
load first, from wherever the OS starts the app. _Changed:_
[native-platform.md](../design/native-platform.md#launch-time-modules)'s
open questions on launch timing and loading the code on Android.

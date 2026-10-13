# 0096. iOS background tasks are package code a launch module registers

- **Date:** 2026-10-13
- **Status:** accepted

The decision [T132](../tasks.md#t132) asks for. Lucent's core knows nothing
of `BGTaskScheduler`. A package's launch module
([0092](0092-launch-runs-in-the-apps-launch-and-android-loads-lucent-by-itself.md))
registers its handlers through `lucent:ios/BackgroundTasks`, as ordinary
Lucent code, while `application(_:didFinishLaunchingWithOptions:)` runs.
A handler is a Lucent function the scheduler calls. It runs holding its
module's actor, and needs no JavaScript runtime, since launch holds module
state for the process. It ends its own work: the task's
`expirationHandler` aborts an `AbortController`, and the handler calls
`setTaskCompleted(success:)`.

The `Info.plist` entries the scheduler needs, `BGTaskSchedulerPermittedIdentifiers`
and `UIBackgroundModes`, come from the package's `lucent.json`
`ios.infoPlist`. The Expo config plugin writes them, and a bare app's
`lucent build` names the ones its `Info.plist` lacks, as for any entry.
The build doesn't otherwise check them. On the simulator, which never
launches a background task, a test runs the package's handler with a
stand-in task, and checks that launch registered it in time.

_Why:_ recognizing `BGTaskScheduler` calls by name would be a catalog
entry, which the no-catalog rule keeps out of core
([0005](0005-the-native-platform-plan-and-the-no-catalog-rule.md)). The
mechanisms the handler needs are core's: launch, module state with no
runtime, and callbacks that hold the actor. The scheduler refuses a
handler registered after launch, so `register`'s result at launch checks
the timing on the simulator. _Changed:_
[native-platform.md](../design/native-platform.md#ios-background-execution)'s
open question.

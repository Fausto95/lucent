# lucent-background-task

A background app refresh, as
[expo-background-task](https://docs.expo.dev/versions/latest/sdk/background-task/)
runs one, written in Lucent with no JavaScript: a launch module registers
its handler with `BGTaskScheduler` while the app launches, and the
scheduler runs it later, in a process it may have launched for it.

On Android, WorkManager runs a `Worker` written in Lucent.

```ts
import { isRegistered, lastRun, schedule, scheduleWork, workRuns } from "lucent-background-task";

isRegistered(); // true: launch registered the handler in time
schedule(); // "scheduled", or why not
lastRun(); // "1 runs, last completed"

scheduleWork(); // Android: "scheduled", every 15 minutes
workRuns(); // "1 runs"
```

## Files

- `src/refresh.lucent.ts`: the launch module. It registers the handler,
  runs the work with an `AbortSignal` the task's expiration aborts, and
  reports how the run ended.
- `src/work.android.lucent.ts`: the `Refresh` Worker, exported and
  extending `Worker`, so WorkManager makes it by its Java name,
  `dev.lucent.app.lucent_background_task.work.Refresh`, with the
  constructor it calls. `scheduleWork` passes the class itself where
  WorkManager takes a `Class<? extends ListenableWorker>`.
- `src/work.ios.lucent.ts` and `src/work.lucent.ts`: iOS's side, which
  has nothing to schedule, and what JavaScript sees on both platforms.
- `lucent.json`: `"launch": ["refresh"]`, the `Info.plist` entries the
  scheduler needs, `BGTaskSchedulerPermittedIdentifiers` and
  `UIBackgroundModes`, and WorkManager on Android.
- `index.ts`: re-exports the modules; Metro bundles their proxies.

## What it shows

- A registration the OS takes only during launch, from a launch module.
- A platform callback running Lucent code, which needs no JavaScript.
- An expiration that stops the work through its `AbortSignal`.
- How to test it on the simulator, which never launches background tasks:
  `runAsScheduled` runs the same handler with a stand-in task.
- A WorkManager `Worker` written in Lucent, which the OS makes by name
  for each run.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Run on the iOS simulator and the Android emulator in the bare example's device runs, whose Platform screen checks that launch registered the handler and runs it with a stand-in task (2026-10-13). Not yet run on a physical device.

<!-- /evidence -->

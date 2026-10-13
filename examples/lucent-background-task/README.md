# lucent-background-task

A background app refresh, as
[expo-background-task](https://docs.expo.dev/versions/latest/sdk/background-task/)
runs one, written in Lucent with no JavaScript: a launch module registers
its handler with `BGTaskScheduler` while the app launches, and the
scheduler runs it later, in a process it may have launched for it.

```ts
import { isRegistered, lastRun, schedule } from "lucent-background-task";

isRegistered(); // true: launch registered the handler in time
schedule(); // "scheduled", or why not
lastRun(); // "1 runs, last completed"
```

## Files

- `src/refresh.lucent.ts`: the launch module. It registers the handler,
  runs the work with an `AbortSignal` the task's expiration aborts, and
  reports how the run ended.
- `lucent.json`: `"launch": ["refresh"]`, and the `Info.plist` entries the
  scheduler needs, `BGTaskSchedulerPermittedIdentifiers` and
  `UIBackgroundModes`.
- `index.ts`: re-exports the module; Metro bundles its proxy.

## What it shows

- A registration the OS takes only during launch, from a launch module.
- A platform callback running Lucent code, which needs no JavaScript.
- An expiration that stops the work through its `AbortSignal`.
- How to test it on the simulator, which never launches background tasks:
  `runAsScheduled` runs the same handler with a stand-in task.

Android runs such work through WorkManager. Its `Worker` is a class the OS
makes, which Lucent code can't be yet.

<!-- evidence: from evidence.json, written by scripts/example-evidence.ts -->

**Evidence:** Run on the iOS simulator and the Android emulator in the bare example's device runs, whose Platform screen checks that launch registered the handler and runs it with a stand-in task (2026-10-13). Not yet run on a physical device.

<!-- /evidence -->

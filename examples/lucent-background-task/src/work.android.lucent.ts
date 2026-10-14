// A WorkManager Worker written in Lucent. Exported and extending an
// Android class, it is one the OS makes by its name (decision 0097):
// dev.lucent.app.lucent_background_task.work.Refresh, with the constructor
// WorkManager calls, (Context, WorkerParameters). WorkManager stores that
// name with the work it schedules, and makes a Refresh for each run, on a
// background thread, in a process it may have started for it. doWork runs
// while WorkManager waits for its result, holding the module's actor.
import { appContext, currentActivity } from "lucent:android";
import type { Context } from "lucent:android/android.content";
import {
  ExistingPeriodicWorkPolicy,
  ListenableWorker_Result,
  PeriodicWorkRequest_Builder,
  WorkManager,
  Worker,
  type WorkerParameters,
} from "lucent:android/androidx.work";
import { TimeUnit } from "lucent:android/java.util.concurrent";
import { delay } from "lucent:core";
import { main } from "lucent:thread";

/** The unique work's name, which WorkManager keeps one of. */
const NAME = "dev.lucent.example.refresh";

let runs = 0;

export class Refresh extends Worker {
  constructor(context: Context, params: WorkerParameters) {
    super(context, params);
  }

  doWork(): ListenableWorker_Result {
    runs++;
    return ListenableWorker_Result.success();
  }
}

export function scheduleWork(): string {
  // The class itself, where WorkManager takes a Class<? extends ListenableWorker>.
  const request = new PeriodicWorkRequest_Builder(Refresh, 15n, TimeUnit.MINUTES).build();
  WorkManager.getInstance(appContext()).enqueueUniquePeriodicWork(
    NAME,
    ExistingPeriodicWorkPolicy.KEEP,
    request,
  );
  return "scheduled";
}

export function workRuns(): string {
  return `${runs} runs`;
}

export async function workInBackground(ms: number): Promise<string> {
  const before = runs;
  const moved = await main(() => currentActivity()?.moveTaskToBack(true) ?? false);
  if (!moved) return "not moved to the background";

  scheduleWork();
  for (let waited = 0; runs === before && waited < ms; waited += 250) await delay(250);

  return runs > before ? "ran in the background" : `no run in ${ms} ms`;
}

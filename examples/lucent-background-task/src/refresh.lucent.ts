// A background app refresh, as expo-background-task's, with no JavaScript:
// a launch module registers its handler with BGTaskScheduler while the app
// finishes launching, as the scheduler requires, and the scheduler runs it
// later, in a process it may have launched for it. The task's expiration
// aborts the work's signal, and the handler reports how it ended. Android
// runs such work through WorkManager, whose Worker is a class the OS makes
// (T131).
import { PLATFORM } from "lucent:platform";
import { type BGTask, BGAppRefreshTaskRequest, BGTaskScheduler } from "lucent:ios/BackgroundTasks";
import { delay } from "lucent:core";

/** The task's identifier, which Info.plist's BGTaskSchedulerPermittedIdentifiers lists (lucent.json). */
export const IDENTIFIER = "dev.lucent.example.refresh";

/** What a run needs from its task: the scheduler's, or a stand-in. */
interface Task {
  /** Calls `expired` once the task's time is up. */
  onExpire: (expired: () => void) => void;
  complete: (success: boolean) => void;
}

let runs = 0;
let last = "none";

// At launch: the scheduler refuses a handler once the app has finished launching.
const registered = register();

function register(): boolean {
  if (PLATFORM !== "ios") return false;

  return BGTaskScheduler.shared.register(IDENTIFIER, null, (task: BGTask) => {
    void run(scheduled(task));
  });
}

/** The scheduler's task as a run sees it. */
function scheduled(task: BGTask): Task {
  return {
    onExpire: (expired: () => void) => {
      task.expirationHandler = expired;
    },
    complete: (success: boolean) => task.setTaskCompleted(success),
  };
}

/** A run: the work, stopped if the task expires first, then the task's completion. */
async function run(task: Task): Promise<void> {
  const controller = new AbortController();
  task.onExpire(() => controller.abort());

  let success = true;
  try {
    await work(controller.signal);
  } catch {
    success = false;
  }

  runs++;
  last = success ? "completed" : "expired";
  task.complete(success);
}

/** The refresh's work: here a pause, which an expiration cuts short. */
async function work(signal: AbortSignal): Promise<void> {
  await delay(200, signal);
}

/** Whether launch registered the handler (iOS): the scheduler takes one only then. */
export function isRegistered(): boolean {
  return registered;
}

/** Asks the scheduler for a refresh: "scheduled", or why it wasn't (the simulator has no scheduler). */
export function schedule(): string {
  if (PLATFORM !== "ios") return "none";

  try {
    BGTaskScheduler.shared.submit(new BGAppRefreshTaskRequest(IDENTIFIER));
    return "scheduled";
  } catch (e) {
    return `not scheduled: ${(e as Error).message}`;
  }
}

async function expireAfter(ms: number, expired: () => void): Promise<void> {
  await delay(ms);
  expired();
}

/**
 * Runs the handler as the scheduler would, with a stand-in task that
 * expires after `expireAfterMs` (never, when negative): how the simulator,
 * which never launches background tasks, tests it.
 */
export async function runAsScheduled(expireAfterMs: number): Promise<string> {
  let completed = "not completed";
  const stand: Task = {
    onExpire: (expired: () => void) => {
      if (expireAfterMs >= 0) void expireAfter(expireAfterMs, expired);
    },
    complete: (success: boolean) => {
      completed = success ? "completed" : "expired";
    },
  };

  await run(stand);
  return completed;
}

/** How many runs ended, and how the last one did. */
export function lastRun(): string {
  return `${runs} runs, last ${last}`;
}

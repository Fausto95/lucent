// A periodic refresh on Android, through WorkManager, whose Worker is a
// Lucent class the OS makes by its name (work.android.lucent.ts). iOS's
// refresh is BGTaskScheduler's (refresh.lucent.ts).

/**
 * Asks WorkManager for a refresh every 15 minutes, its shortest period:
 * "scheduled" ("none" on iOS). Its first run comes as soon as WorkManager
 * can.
 */
export declare function scheduleWork(): string;

/** How many times the Worker ran in this process ("none" on iOS). */
export declare function workRuns(): string;

/**
 * Puts the app in the background, schedules the refresh, and waits at
 * most `ms` for WorkManager to run it: "ran in the background", or why not
 * ("none" on iOS).
 */
export declare function workInBackground(ms: number): Promise<string>;

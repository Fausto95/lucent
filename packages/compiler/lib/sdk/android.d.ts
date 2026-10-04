// lucent:android — Android helpers for platform code.
import type { Activity, Instrumentation_ActivityResult } from "lucent:android/android.app";
import type { Context, Intent } from "lucent:android/android.content";

/** The application Context. */
export declare function appContext(): Context;

/** Whether the device runs at least API level `api` (`Build.VERSION.SDK_INT >= api`). */
export declare function available(platform: "android", api: number): boolean;

/**
 * The Activity in front: the one last created, started or resumed and not
 * destroyed, or null (before the first, between two, after the last).
 * Lucent holds Activities weakly: use this one now, on the main thread
 * (inside `main()`), and ask again later rather than keeping it.
 */
export declare function currentActivity(): Activity | null;

/**
 * Starts `intent` from the Activity in front, and resolves with its result
 * (`getResultCode()`, `getResultData()`). The request survives the app's
 * Activity being recreated meanwhile.
 *
 * It rejects with `ERR_NO_ACTIVITY` without an Activity, and with
 * `ERR_ACTIVITY_NOT_FOUND` when no app handles the intent. It rejects with
 * the signal's reason if it aborts first, and drops the answer if it comes.
 * Lucent closes what it started when Android lets it.
 */
export declare function startActivityForResult(
  intent: Intent,
  signal?: AbortSignal,
): Promise<Instrumentation_ActivityResult>;

/**
 * Asks for runtime permissions (`"android.permission.CAMERA"`), and
 * resolves with whether each was granted, in order. Requests wait for the
 * one before them, as Android asks one at a time. It rejects like
 * `startActivityForResult`.
 */
export declare function requestPermissions(
  permissions: string[],
  signal?: AbortSignal,
): Promise<boolean[]>;

/** The lifecycle events of the app's Activities, and a new intent sent to one. */
export type ActivityEvent =
  | "created"
  | "started"
  | "resumed"
  | "paused"
  | "stopped"
  | "destroyed"
  | "newIntent";

/**
 * Runs `handler` after each `event` of the app's Activities, with the
 * Activity (and the intent, for "newIntent"), in a turn of the calling
 * context. Returns the function that stops it.
 */
export declare function onActivityEvent(
  event: ActivityEvent,
  handler: (activity: Activity, intent: Intent | null) => void,
): () => void;

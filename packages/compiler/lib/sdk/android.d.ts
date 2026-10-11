// lucent:android — Android helpers for platform code.
import type { Activity, Instrumentation_ActivityResult } from "lucent:android/android.app";
import type { Context, Intent } from "lucent:android/android.content";
import type { Throwable } from "lucent:android/java.lang";
import type { ByteBuffer } from "lucent:android/java.nio";
import type { NativeBuffer } from "lucent:core";

/** The application Context. */
export declare function appContext(): Context;

/**
 * The Error Lucent makes of `throwable` when a call throws it. Its message is
 * the exception's (or its class name, without one), and its `code` is the class
 * name (`java.lang.IllegalStateException`). An exception carrying a Lucent
 * error, one a Lucent suspend function ended a Kotlin call with, gives that error.
 *
 * For an adapter whose callback API reports failure with a Throwable,
 * `reject(errorOf(e))` rejects as the call would have thrown.
 *
 * @param throwable The exception, such as one a callback received.
 */
export declare function errorOf(throwable: Throwable): Error;

/**
 * The Java exception `error` came from: what a call threw, or a callback
 * gave `errorOf`. Test its class with `instanceof` and read its members,
 * rather than matching `code`. Null for an error Lucent or JavaScript made.
 *
 * ```ts
 * import { nativeError } from "lucent:android";
 * import { FileInputStream, FileNotFoundException } from "lucent:android/java.io";
 *
 * function open(path: string): FileInputStream | null {
 *   try {
 *     return new FileInputStream(path);
 *   } catch (e) {
 *     if (nativeError(e as Error) instanceof FileNotFoundException) return null;
 *     throw e;
 *   }
 * }
 * ```
 *
 * @param error A caught error.
 */
export declare function nativeError(error: Error): Throwable | null;

/**
 * A NativeBuffer of a direct ByteBuffer's bytes, all of its capacity,
 * uncopied: what an SDK hands over as a direct buffer (a decoder's output,
 * a library's storage) becomes bytes Lucent owns, which can move to a
 * worker or, with `transferToArrayBuffer()`, to JavaScript without a copy.
 * The Java buffer is kept reachable until the bytes are released.
 *
 * Adopting hands the bytes over: Java code must not read or write the
 * buffer from then on, and the bytes are only as valid as whatever made
 * them keeps them (an `Image`'s planes end at `close()`).
 *
 * ```ts
 * import { adoptByteBuffer } from "lucent:android";
 * import type { ByteBuffer } from "lucent:android/java.nio";
 *
 * // A decoder's direct output, for JavaScript: no copy on the way.
 * function forJavaScript(decoded: ByteBuffer): ArrayBuffer {
 *   return adoptByteBuffer(decoded).transferToArrayBuffer();
 * }
 * ```
 *
 * @param buffer A direct ByteBuffer (`ByteBuffer.allocateDirect`), not
 * read-only: a heap or read-only buffer is a TypeError.
 */
export declare function adoptByteBuffer(buffer: ByteBuffer): NativeBuffer;

/**
 * Whether the device runs at least API level `api` (`Build.VERSION.SDK_INT >= api`).
 *
 * @param platform Always `"android"`.
 * @param api The API level, such as `31`.
 */
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
 *
 * @param intent What to start.
 * @param signal Rejects with its reason; a later answer is dropped.
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
 *
 * @param permissions Their names, such as `"android.permission.CAMERA"`.
 * @param signal Rejects with its reason; a later answer is dropped.
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
 *
 * @param event The lifecycle event, or `"newIntent"`.
 * @param handler Called with the Activity, and the intent for `"newIntent"`.
 */
export declare function onActivityEvent(
  event: ActivityEvent,
  handler: (activity: Activity, intent: Intent | null) => void,
): () => void;

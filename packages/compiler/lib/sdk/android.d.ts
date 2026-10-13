// lucent:android — Android helpers for platform code.
import type { Activity, Instrumentation_ActivityResult } from "lucent:android/android.app";
import type { Context, Intent } from "lucent:android/android.content";
import type { Throwable } from "lucent:android/java.lang";
import type { HardwareBuffer } from "lucent:android/android.hardware";
import type { KeyEvent } from "lucent:android/android.view";
import type { ByteBuffer } from "lucent:android/java.nio";
import type { NativeBuffer, NativeHandle } from "lucent:core";

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
 * uncopied; the Java buffer is kept reachable until the bytes are
 * released. What an SDK hands over as a direct buffer (a decoder's output,
 * a library's storage) becomes bytes Lucent owns. They can move to a
 * worker, or to JavaScript with `transferToArrayBuffer()`, without a copy.
 *
 * Adopting hands the bytes over: Java code must not read or write the
 * buffer from then on. The bytes are only as valid as whatever made them
 * keeps them (an `Image`'s planes end at `close()`).
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
 * A NativeBuffer of a HardwareBuffer's bytes, uncopied, locked for the CPU
 * until they're released, then unlocked. A camera's or a decoder's frame
 * (`Image.getHardwareBuffer()`) can move to a worker, or with
 * `"readwrite"` to JavaScript (`transferToArrayBuffer()`), without a copy.
 *
 * The bytes are `stride × height` pixels of one plane. A read-only
 * buffer's writes throw `InvalidStateError`, and so does
 * `transferToArrayBuffer()`, since an ArrayBuffer is writable. Needs
 * Android 8 (API 26), as HardwareBuffer does.
 *
 * ```ts
 * import { adoptHardwareBuffer, available } from "lucent:android";
 * import type { Image } from "lucent:android/android.media";
 *
 * // A frame's pixels, for JavaScript: no copy on the way.
 * function forJavaScript(frame: Image): ArrayBuffer | null {
 *   if (!available("android", 28)) return null;
 *   const pixels = frame.getHardwareBuffer();
 *   return pixels ? adoptHardwareBuffer(pixels, "readwrite").transferToArrayBuffer() : null;
 * }
 * ```
 *
 * @param buffer A HardwareBuffer of one layer and one plane (RGBA_8888,
 * RGB_565, BLOB…), made for the CPU uses asked: otherwise a TypeError.
 * @param access `"read"` (the default) locks it for reading, and
 * `"readwrite"` for writing too.
 */
export declare function adoptHardwareBuffer(
  buffer: HardwareBuffer,
  access?: "read" | "readwrite",
): NativeBuffer;

/**
 * A handle native code reads: a direct ByteBuffer's bytes' address, the
 * Java buffer kept reachable until the handle is released. A library that
 * takes a pointer (a decoder, a GPU upload) gets `pointer`; JavaScript gets
 * the same handle. Release it, from either side, once the library is done.
 *
 * @param buffer A direct ByteBuffer (`ByteBuffer.allocateDirect`): a heap
 * buffer is a TypeError.
 */
export declare function handleOf(buffer: ByteBuffer): NativeHandle;
/**
 * A HardwareBuffer's `AHardwareBuffer*` (the NDK's), acquired until the
 * handle is released. Native code that draws or uploads it takes the
 * pointer, such as a camera frame going to Skia. Needs Android 8 (API 26),
 * as HardwareBuffer does.
 *
 * ```ts
 * import { available, handleOf } from "lucent:android";
 * import type { NativeHandle } from "lucent:core";
 * import type { HardwareBuffer } from "lucent:android/android.hardware";
 *
 * function forSkia(frame: HardwareBuffer): NativeHandle | null {
 *   return available("android", 26) ? handleOf(frame) : null;
 * }
 * ```
 *
 * @param buffer The HardwareBuffer: it may be closed while the handle holds its buffer.
 */
export declare function handleOf(buffer: HardwareBuffer): NativeHandle;

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

/**
 * The lifecycle events of the app's Activities, and a new intent sent to
 * one. From AndroidX's listeners also a configuration change, such as a
 * rotation or dark mode, and the person leaving the app with Home.
 */
export type ActivityEvent =
  | "created"
  | "started"
  | "resumed"
  | "paused"
  | "stopped"
  | "destroyed"
  | "newIntent"
  | "configurationChanged"
  | "userLeaveHint";

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

/**
 * Runs `handler` on each back press, on the main thread while Android
 * waits for its answer: true consumes the press. With no module consuming
 * it, back goes on as it would without Lucent. React Native's own
 * handling, JavaScript's `BackHandler`, comes first.
 *
 * Lucent hears it through AndroidX's `OnBackPressedDispatcher`, the one way
 * an app targeting Android 16 does, enabled only while a module listens.
 *
 * ```ts
 * import { onActivityEvent } from "lucent:android";
 *
 * // Closes the module's panel before the screen goes.
 * function closeOnBack(isOpen: () => boolean, close: () => void): () => void {
 *   return onActivityEvent("backPressed", () => {
 *     if (!isOpen()) return false;
 *     close();
 *     return true;
 *   });
 * }
 * ```
 *
 * @param event `"backPressed"`.
 * @param handler Called with the Activity; true if it consumed the press.
 */
export declare function onActivityEvent(
  event: "backPressed",
  handler: (activity: Activity) => boolean,
): () => void;

/**
 * Runs `handler` with each key press the app's views and Activity didn't
 * handle, as it goes down (`"keyDown"`) or comes up (`"keyUp"`). It runs
 * on the main thread while Android waits: true consumes the key, before
 * the window's own handling of volume and media keys.
 *
 * Lucent wraps the Activities' window callbacks while a module listens,
 * so the app's `MainActivity` needs no lines. A camera module, say, takes
 * `KeyEvent.KEYCODE_VOLUME_UP` as its shutter.
 *
 * @param event `"keyDown"` or `"keyUp"`.
 * @param handler Called with the Activity and the key event; true if it consumed it.
 */
export declare function onActivityEvent(
  event: "keyDown" | "keyUp",
  handler: (activity: Activity, key: KeyEvent) => boolean,
): () => void;

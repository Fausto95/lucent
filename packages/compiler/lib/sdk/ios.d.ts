// lucent:ios — iOS helpers for platform code.

import type { NativeBuffer, NativeHandle } from "lucent:core";
import type { NSError } from "lucent:ios/Foundation";
import type { UIView, UIViewController } from "lucent:ios/UIKit";
import type { ComponentView } from "lucent:ui";

/**
 * Whether the OS is at least `major.minor` (Swift's `#available`).
 *
 * @param platform Always `"ios"`.
 * @param major The major version, such as `16`.
 * @param minor The minor version; 0 when left out.
 */
export declare function available(platform: "ios", major: number, minor?: number): boolean;

/** The root of Objective-C objects. Values of type `Any` (`id`) arrive as NSObjects. */
export declare class NSObject {
  private readonly __lucent_NSObject: never;
  protected constructor();
}

/** What can go where Objective-C takes `Any` (`id`), CoreFoundation values included. */
export type ObjCValue = string | number | boolean | Uint8Array | Date | NSObject | null;

/** The main dispatch queue (dispatch_get_main_queue()), for APIs that take a queue. */
export declare function mainQueue(): NSObject;

/**
 * A new serial dispatch queue (`dispatch_queue_create(label, DISPATCH_QUEUE_SERIAL)`).
 * It's for APIs that call their delegate on a queue you pass, such as
 * AVCaptureVideoDataOutput's `setSampleBufferDelegate(_:queue:)`. Their
 * callbacks then run off the main thread, one at a time, and Lucent
 * code in them runs as in any other callback.
 *
 * @param label The queue's name, as Instruments and crash reports show it, such as `"camera.frames"`.
 */
export declare function serialQueue(label: string): NSObject;

/**
 * A handle native code reads: the object's address, retained (+1) until
 * the handle is released, then released once. A library that takes an
 * `id` or a CF type, such as a frame processor taking a CVPixelBufferRef,
 * gets `pointer`; JavaScript gets the same handle. Release it, from either
 * side, once the library is done.
 *
 * ```ts
 * import { type NSObject, retainedHandle } from "lucent:ios";
 * import type { NativeHandle } from "lucent:core";
 *
 * // A camera frame's CVPixelBuffer, as a sample buffer delegate gets it.
 * function forSkia(pixelBuffer: NSObject): NativeHandle {
 *   return retainedHandle(pixelBuffer);
 * }
 * ```
 *
 * @param object The object to hold: a nil one is a TypeError.
 */
export declare function retainedHandle(object: NSObject): NativeHandle;

/**
 * Calls `f` with a CVPixelBuffer's bytes, locked for reading while it
 * runs. The lock is `CVPixelBufferLockBaseAddress` with
 * `kCVPixelBufferLock_ReadOnly`, released after `f`, also when it throws.
 * `f` gets the plane's bytes, its row stride (`bytesPerRow`), width and
 * height.
 *
 * For a planar format (YUV), the plane is the one given; otherwise plane
 * 0. The bytes are copied once, under the lock, so they stay valid after
 * `f` returns. The buffer itself is locked only while `f` runs.
 *
 * @param pixelBuffer A CVPixelBuffer, such as `CMSampleBufferGetImageBuffer(sample)`.
 * @param f What reads the bytes; its result is withPixelBytes's.
 * @param plane The plane of a planar format; 0 when left out.
 */
export declare function withPixelBytes<R>(
  pixelBuffer: NSObject,
  f: (bytes: Uint8Array, bytesPerRow: number, width: number, height: number) => R,
  plane?: number,
): R;

/**
 * A NativeBuffer of a CVPixelBuffer plane's bytes, uncopied: the pixel
 * buffer is retained and locked until they're released, then unlocked. A
 * camera frame can move to a worker, or with `"readwrite"` to JavaScript
 * (`transferToArrayBuffer()`), without a copy. `withPixelBytes` is the
 * form that copies.
 *
 * The bytes are the plane's `bytesPerRow × height`. A read-only buffer's
 * writes throw `InvalidStateError`, and so does `transferToArrayBuffer()`,
 * since an ArrayBuffer is writable.
 *
 * ```ts
 * import { adoptPixelBuffer, type NSObject } from "lucent:ios";
 *
 * // A frame's pixels, for JavaScript: no copy on the way.
 * function forJavaScript(pixelBuffer: NSObject): ArrayBuffer {
 *   return adoptPixelBuffer(pixelBuffer, 0, "readwrite").transferToArrayBuffer();
 * }
 * ```
 *
 * @param pixelBuffer A CVPixelBuffer, such as `CMSampleBufferGetImageBuffer(sample)`.
 * @param plane The plane of a planar format; 0 when left out.
 * @param access `"read"` (the default) locks it for reading, and
 * `"readwrite"` for writing too.
 */
export declare function adoptPixelBuffer(
  pixelBuffer: NSObject,
  plane?: number,
  access?: "read" | "readwrite",
): NativeBuffer;

/** Swift's `as? String`: the string an `Any` holds, or null. */
export declare function asString(value: NSObject | null): string | null;
/** Swift's `as? Double` (an NSNumber). */
export declare function asNumber(value: NSObject | null): number | null;
/** Swift's `as? Bool` (an NSNumber). */
export declare function asBoolean(value: NSObject | null): boolean | null;
/** Swift's `as? Data`. */
export declare function asData(value: NSObject | null): Uint8Array | null;
/** Swift's `as? Date`. */
export declare function asDate(value: NSObject | null): Date | null;

/**
 * The NSError `error` came from: what a throwing method, an `NSError**`
 * out-parameter or a completion handler gave. Read its `domain`, `code` and
 * `userInfo` as the SDK types them, rather than parsing `code`
 * (`"NSCocoaErrorDomain:260"`). Null for an error Lucent or JavaScript made.
 *
 * ```ts
 * import { nativeError } from "lucent:ios";
 * import { FileManager, NSCocoaErrorDomain } from "lucent:ios/Foundation";
 *
 * function exists(path: string): boolean {
 *   try {
 *     FileManager.default.attributesOfItem(path);
 *     return true;
 *   } catch (e) {
 *     const ns = nativeError(e as Error);
 *     // NSFileReadNoSuchFileError: the file isn't there.
 *     if (ns?.domain === NSCocoaErrorDomain && ns.code === 260n) return false;
 *     throw e;
 *   }
 * }
 * ```
 *
 * @param error A caught error.
 */
export declare function nativeError(error: Error): NSError | null;

/**
 * What a method writes through a pointer (`CGFloat *`, `NSRange *`,
 * `NSDate **`, `CFTypeRef *`): pass it, then read `value`. For a pointer the
 * method also reads (a number or a struct), set `value` first.
 */
export declare class Out<T> {
  constructor();
  value: T | null;
}

/**
 * A Swift AsyncSequence, such as StoreKit's `Transaction.updates` or an
 * `AsyncStream`, collected as Kotlin's Flow is. `collect` calls `f` with
 * each element in order on its package's thread, and the sequence waits for
 * each call. It settles when the sequence ends, rejecting with what the
 * sequence or `f` throws.
 *
 * Aborting `signal` cancels the iteration's task.
 */
export declare class AsyncSequence<T> {
  private readonly __lucent_AsyncSequence: never;
  protected constructor();
  /**
   * @param f Called with each element; a function that is not async (the sequence would not wait for its promise).
   * @param signal Cancels the iteration; the promise rejects with AbortError.
   */
  collect(f: (value: T) => void, signal?: AbortSignal): Promise<void>;
}

/**
 * UIApplication's lifecycle notifications, by name: `"didBecomeActive"` is
 * `UIApplication.didBecomeActiveNotification`.
 */
export type AppEvent =
  | "didBecomeActive"
  | "willResignActive"
  | "didEnterBackground"
  | "willEnterForeground"
  | "didReceiveMemoryWarning"
  | "willTerminate";

/**
 * UIScene's lifecycle notifications, by name: `"willConnect"` is
 * `UIScene.willConnectNotification`.
 */
export type SceneEvent =
  | "willConnect"
  | "didDisconnect"
  | "didActivate"
  | "willDeactivate"
  | "willEnterForeground"
  | "didEnterBackground";

/**
 * Calls `listener` each time the app posts `event`, until the returned
 * function is called or `signal` aborts. It runs on the main thread, as
 * UIKit posts it, so main-thread APIs work there without `main()`.
 *
 * Lucent observes the notifications, so the app's delegate and other
 * modules' stay as they are. What `listener` throws is logged, and the app
 * goes on. App extensions have no app to observe.
 *
 * @param event The notification, by name.
 * @param listener Called on the main thread each time it is posted.
 * @param signal Stops listening, as the returned function does.
 * @extensionUnavailable
 */
export declare function onAppEvent(
  event: AppEvent,
  listener: () => void,
  signal?: AbortSignal,
): () => void;

/** A remote notification's or a background fetch's answer, as UIBackgroundFetchResult names it. */
export type FetchResult = "newData" | "noData" | "failed";

/** How a notification that arrives in the foreground is shown: none of them hides it. */
export type NotificationPresentation = "banner" | "list" | "sound" | "badge";

/**
 * Why iOS launched the app. It may run in the background for a location
 * event or a Bluetooth accessory. Or the person opened one of its
 * notifications.
 */
export type RelaunchReason =
  | "location"
  | "bluetoothCentrals"
  | "bluetoothPeripherals"
  | "notification";

/**
 * Calls `listener` with each URL the app is asked to open, and the bundle
 * id of the app that asked (`""` when iOS doesn't say). It answers whether
 * it opened the URL.
 *
 * The URL comes from the app delegate, or the scene delegate in an app with
 * scenes, which forwards it to Lucent. A URL that launched the app waits for
 * the first listener. `listener` runs on the main thread while iOS waits
 * for its answer.
 *
 * ```ts
 * import { onAppEvent } from "lucent:ios";
 *
 * function watchLinks(open: (path: string) => void): () => void {
 *   return onAppEvent("openURL", (url) => {
 *     if (!url.startsWith("myapp://")) return false;
 *     open(url.slice("myapp://".length));
 *     return true;
 *   });
 * }
 * ```
 *
 * @param event `"openURL"`.
 * @param listener Called with the URL and the asking app's bundle id.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "openURL",
  listener: (url: string, sourceApplication: string) => boolean,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each user activity the app is asked to continue,
 * such as a universal link or a Spotlight result. It gets the activity's
 * `activityType`, its web page URL (`""` for none) and its `userInfo` as
 * JSON, and answers whether it continued it. One that launched the app
 * waits for the first listener.
 *
 * @param event `"userActivity"`.
 * @param listener Called with the type, the URL and the userInfo's JSON.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "userActivity",
  listener: (type: string, webpageURL: string, userInfo: string) => boolean,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each home screen quick action the person chose:
 * its `type`, its title and its `userInfo` as JSON. It answers whether it
 * handled it. One that launched the app waits for the first listener.
 *
 * @param event `"shortcutItem"`.
 * @param listener Called with the type, the title and the userInfo's JSON.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "shortcutItem",
  listener: (type: string, title: string, userInfo: string) => boolean,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with the device token for push notifications, once the
 * app registered (`UIApplication.shared.registerForRemoteNotifications()`).
 * A token that came before any listener waits for the first one.
 *
 * @param event `"pushToken"`.
 * @param listener Called with the token's bytes.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "pushToken",
  listener: (token: Uint8Array) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with the error when registering for push notifications
 * fails, an `Error` whose `code` is the NSError's.
 *
 * @param event `"pushTokenFailed"`.
 * @param listener Called with the error.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "pushTokenFailed",
  listener: (error: Error) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each remote notification's `userInfo` as JSON,
 * the app in the foreground or woken for it. It resolves with what it
 * fetched.
 *
 * The modules' answers merge as Expo merges them: new data if any had
 * some, else failed if any failed. iOS gets them after 25 seconds at the
 * latest.
 *
 * @param event `"remoteNotification"`.
 * @param listener Called with the userInfo's JSON.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "remoteNotification",
  listener: (userInfo: string) => Promise<FetchResult>,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` when iOS wakes the app for a background fetch. Its
 * answer merges with other modules' as a remote notification's does.
 *
 * @param event `"backgroundFetch"`.
 * @param listener Called for each fetch.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "backgroundFetch",
  listener: () => Promise<FetchResult>,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` when iOS wakes the app for a background URL session's
 * events, with the session's identifier. It answers whether the session is
 * its own, then calls `done` once it handled them. iOS hears once every
 * module that claimed it is done.
 *
 * @param event `"backgroundURLSession"`.
 * @param listener Called with the identifier, and `done`.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "backgroundURLSession",
  listener: (identifier: string, done: () => void) => boolean,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` each time iOS asks which orientations the app supports.
 * It answers a `UIInterfaceOrientationMask`, or 0 for no say: iOS gets the
 * orientations every module that has a say allows, of those the app does.
 *
 * @param event `"supportedInterfaceOrientations"`.
 * @param listener Answers the orientations it allows.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "supportedInterfaceOrientations",
  listener: () => number,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each reason iOS launched the app for, and its
 * details as JSON. The reasons wait for the first listener. A module that
 * resumes location or Bluetooth work learns from them why the app runs.
 *
 * The details are `{}` for `"location"`, and for Bluetooth the
 * `restorationIdentifiers` of the managers to make again. For a
 * notification they are its `userInfo`, given once even when both
 * delegates report it.
 *
 * @param event `"relaunched"`.
 * @param listener Called with the reason and its details' JSON.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "relaunched",
  listener: (reason: RelaunchReason, details: string) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each notification that arrives while the app is
 * in the foreground, as JSON. It answers how iOS shows it: `[]` hides it.
 *
 * The JSON has the request's `identifier`, its content's `title`,
 * `subtitle`, `body`, `badge`, `categoryIdentifier`, `threadIdentifier`
 * and `userInfo`, its `date` in milliseconds, and whether it is `remote`.
 *
 * The first listener puts Lucent in front of `UNUserNotificationCenter`'s
 * delegate, which it shares with the app's: that one still gets every
 * call. iOS shows the notification as the modules and the app's delegate
 * asked together.
 *
 * A delegate set after the first listener replaces Lucent's.
 *
 * @param event `"willPresentNotification"`.
 * @param listener Called with the notification's JSON; answers how to show it.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "willPresentNotification",
  listener: (notification: string) => NotificationPresentation[],
  signal?: AbortSignal,
): () => void;

/**
 * Calls `listener` with each response the person gives a notification.
 * It gets the action's identifier, the notification as JSON, and the text
 * typed for a text input action (`""` otherwise). A tap is
 * `"com.apple.UNNotificationDefaultActionIdentifier"`.
 *
 * It shares `UNUserNotificationCenter`'s delegate as
 * `"willPresentNotification"` does. A notification that launched the app
 * comes before any listener, so it is `"relaunched"`'s `"notification"`.
 *
 * @param event `"notificationResponse"`.
 * @param listener Called with the action, the notification's JSON and the text.
 * @param signal Stops listening, as the returned function does.
 */
export declare function onAppEvent(
  event: "notificationResponse",
  listener: (action: string, notification: string, text: string) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Like `onAppEvent`, for each scene's `event`: `listener` gets the scene's
 * session's `persistentIdentifier`. App extensions have no scenes to observe.
 *
 * @param event The notification, by name.
 * @param listener Called with the scene's `persistentIdentifier`.
 * @param signal Stops listening, as the returned function does.
 * @extensionUnavailable
 */
export declare function onSceneEvent(
  event: SceneEvent,
  listener: (scene: string) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Presents the view controller `build` returns from the scene the person is
 * using (the top view controller of its key window). Resolves with the
 * value given to `resolve`, or rejects with the error given to `reject`.
 *
 * `build` runs on the main thread, like `main()`'s function. Make the view
 * controller there, and call `resolve` or `reject` from its delegate or
 * completion handler.
 *
 * It settles once, and whatever settles it dismisses the view controller if
 * it is still shown. It rejects with an `AbortError` when `signal` aborts,
 * or when the person dismisses the view controller (swiping a sheet down).
 * It does too when the view controller goes before settling, or when its
 * scene disconnects.
 *
 * It rejects with an `InvalidStateError` when no scene is in the
 * foreground, or UIKit doesn't present it.
 *
 * A component's code calling it before its first `await` presents from
 * the component's view controller, if its root is one. Unmounting the
 * component dismisses it.
 *
 * App extensions have no scene of the app's to present from.
 *
 * @param build Makes the view controller, on the main thread.
 * @param signal Dismisses it and rejects with an `AbortError`.
 * @extensionUnavailable
 */
export declare function present<T>(
  build: (resolve: (value: T) => void, reject: (reason: Error) => void) => UIViewController,
  signal?: AbortSignal,
): Promise<T>;

declare module "lucent:thread" {
  /** On iOS an executor is its serial dispatch queue: an API that takes a queue takes it. */
  interface Executor extends NSObject {}
}

/**
 * The view the setup of a module function's component returned, or its
 * view controller's view. JavaScript gives the function the component's
 * ref, `ref.current`. Call it inside `main()`: it throws an
 * `InvalidStateError` once the component unmounts.
 *
 * @param view The component's ref, as the module function was given it.
 */
export declare function viewOf(view: ComponentView): UIView;

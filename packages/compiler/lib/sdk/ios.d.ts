// lucent:ios — iOS helpers for platform code.

import type { UIViewController } from "lucent:ios/UIKit";

/** Whether the OS is at least `major.minor` (Swift's `#available`). */
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
 * What a method writes through a pointer (`CGFloat *`, `NSRange *`,
 * `NSDate **`, `CFTypeRef *`): pass it, then read `value`. For a pointer the
 * method also reads (a number or a struct), set `value` first.
 */
export declare class Out<T> {
  constructor();
  value: T | null;
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
 * UIKit posts it, so main-thread APIs work there without `main()`. Lucent
 * observes the notifications: the app's delegate, and other modules', stay
 * as they are. What `listener` throws is logged; the app goes on.
 */
export declare function onAppEvent(
  event: AppEvent,
  listener: () => void,
  signal?: AbortSignal,
): () => void;

/**
 * Like `onAppEvent`, for each scene's `event`: `listener` gets the scene's
 * session's `persistentIdentifier`.
 */
export declare function onSceneEvent(
  event: SceneEvent,
  listener: (scene: string) => void,
  signal?: AbortSignal,
): () => void;

/**
 * Presents the view controller `build` returns from the scene the person is
 * using (the top view controller of its key window), and resolves with the
 * value given to `resolve`, or rejects with the error given to `reject`.
 * `build` runs on the main thread, like `main()`'s function: make the view
 * controller there, and call `resolve` or `reject` from its delegate or
 * completion handler.
 *
 * It settles once, and whatever settles it dismisses the view controller if
 * it is still shown. It rejects with an `AbortError` when `signal` aborts,
 * when the person dismisses the view controller (swiping a sheet down), when
 * the view controller goes before settling, or when its scene disconnects;
 * with an `InvalidStateError` when no scene is in the foreground or UIKit
 * does not present it.
 */
export declare function present<T>(
  build: (resolve: (value: T) => void, reject: (reason: Error) => void) => UIViewController,
  signal?: AbortSignal,
): Promise<T>;

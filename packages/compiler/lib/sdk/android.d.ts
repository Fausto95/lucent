// lucent:android — Android helpers for platform code.
import type { Context } from "lucent:android/android.content";

/** The application Context. */
export declare function appContext(): Context;

/** Whether the device runs at least API level `api` (`Build.VERSION.SDK_INT >= api`). */
export declare function available(platform: "android", api: number): boolean;

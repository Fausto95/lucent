// A launch module (lucent.json's launch): the app creates it at launch,
// before the first frame and before any JavaScript, and its state lasts for
// the process. On iOS that is LucentAppDelegate's
// application(_:didFinishLaunchingWithOptions:), on Android
// LucentInitializer, before Application.onCreate. Registrations the OS
// requires by then belong in a module like this one: here, on Android, a
// notification channel.
import { PLATFORM } from "lucent:platform";
import { NotificationChannel, NotificationManager } from "lucent:android/android.app";
import { appContext, available } from "lucent:android";

/** The notification channel the module creates on Android. */
export const CHANNEL = "lucent-launch";

// The top level runs when module state starts: at launch, for a launch module.
const startedAt = Date.now();
const channelCreated = createChannel();

function createChannel(): boolean {
  if (PLATFORM !== "android") return false;
  if (!available("android", 26)) return false;

  const manager = appContext().getSystemService(NotificationManager);
  if (!manager) return false;
  manager.createNotificationChannel(
    new NotificationChannel(CHANNEL, "Lucent launch", NotificationManager.IMPORTANCE_LOW),
  );
  return manager.getNotificationChannel(CHANNEL) !== null;
}

/** When module state started, as Date.now() gave it: before JavaScript, in an app that launched it. */
export function startedAtMs(): number {
  return startedAt;
}

/** Whether launch created the notification channel (Android 8 and later). */
export function channelReady(): boolean {
  return channelCreated;
}

// A silent push (`content-available: 1`), as expo-notifications' background
// task hears one, with no JavaScript: a launch module subscribes while the
// app launches, so a push that started the process reaches it. iOS gives
// the handler 30 seconds, and the fetch result it answers ends the wake.
// Each push it hears is logged as a LUCENT_PUSH line, which the device runs
// look for after pushing to the ended app.
import { PLATFORM } from "lucent:platform";
import { onAppEvent } from "lucent:ios";

let heard = 0;
let startedForPush = false;

// At launch: the push that started the process comes once the app has finished launching.
const listening = listen();

function listen(): boolean {
  if (PLATFORM !== "ios") return false;

  // iOS says it launched the app for a notification: a silent push's, here.
  onAppEvent("relaunched", (reason) => {
    if (reason === "notification") startedForPush = true;
  });
  onAppEvent("remoteNotification", async (userInfo) => {
    heard++;
    const started = startedForPush ? ", in a process started for it" : "";
    console.log(`LUCENT_PUSH heard ${userInfo}${started}`);
    return "newData";
  });
  return true;
}

/** The silent pushes this process heard: "1 heard, started for one" (iOS), "none" on Android. */
export function pushesHeard(): string {
  if (!listening) return "none";

  return `${heard} heard${startedForPush ? ", started for one" : ""}`;
}

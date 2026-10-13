// A BroadcastReceiver written in Lucent. Exported and extending an Android
// class, it is one the OS makes by its name (decision 0097):
// dev.lucent.app.lucent_broadcast.ping.Ping, which lucent.json's components
// declare in the manifest as `ping#Ping`. Android makes one for each
// broadcast, on the main thread, and its Lucent side runs holding the
// module's actor. JavaScript never sees the class, so ping.lucent.ts
// doesn't declare it.
import { BroadcastReceiver, type Context, Intent } from "lucent:android/android.content";
import { appContext } from "lucent:android";

/** The action the module's broadcasts carry. */
const ACTION = "dev.lucent.example.PING";

let received = 0;
let lastAction = "";

export class Ping extends BroadcastReceiver {
  onReceive(context: Context, intent: Intent): void {
    received++;
    lastAction = intent.getAction() ?? "";
  }
}

export function send(): void {
  const context = appContext();
  const intent = new Intent(ACTION);
  // Explicit: to this app's receiver, by its Java name.
  intent.setClassName(context.getPackageName() ?? "", "dev.lucent.app.lucent_broadcast.ping.Ping");
  context.sendBroadcast(intent);
}

export function heard(): string {
  return `${received} ${lastAction}`;
}

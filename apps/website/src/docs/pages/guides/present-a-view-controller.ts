import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "share.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIActivityViewController } from "lucent:ios/UIKit";
import { onAppEvent, present } from "lucent:ios";

export async function share(text: string, signal?: AbortSignal): Promise<boolean> {
  if (PLATFORM !== "ios") return false;

  return present<boolean>((resolve) => {
    const sheet = new UIActivityViewController([text], null);
    sheet.completionHandler = (_type, completed) => resolve(completed);
    return sheet;
  }, signal);
}

let stop: (() => void) | null = null;

export function onForeground(listener: () => void): void {
  if (PLATFORM === "ios") {
    if (stop) stop();
    stop = onAppEvent("willEnterForeground", listener);
  }
}`,
  },
  {
    kind: "p",
    text: "`present()` from `lucent:ios` shows the view controller its function returns, from the scene the person is using, and resolves with what you pass to `resolve`. The function runs on the main thread, so UIKit works there: make the view controller, and call `resolve` or `reject` from its completion handler or delegate.",
  },
  {
    kind: "list",
    items: [
      "It settles once. Settling dismisses the view controller if it's still shown.",
      "It rejects with an `AbortError` when the signal aborts, when the person swipes the sheet away, or when the scene goes away.",
      "It rejects with an `InvalidStateError` when the app is in the background, or when UIKit won't present it, for example during another presentation.",
    ],
  },
  {
    kind: "p",
    text: '`onAppEvent()` and `onSceneEvent()` call a function on each of UIKit\'s lifecycle notifications, such as `"willEnterForeground"` or a scene\'s `"didActivate"`, on the main thread. Each returns the function that stops it. Your app delegate stays yours.',
  },
  {
    kind: "note",
    tone: "warn",
    text: "A JavaScript reload doesn't stop a presentation or a listener. Stop them, or pass a signal. These APIs are iOS only.",
  },
];

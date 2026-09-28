// Picking a document with the system's picker, on Android: an intent
// started for a result from the Activity in front. The request survives the
// app's Activity being recreated while the picker is open.
import { PLATFORM } from "lucent:platform";
import { Activity } from "lucent:android/android.app";
import { Intent } from "lucent:android/android.content";
import { currentActivity, startActivityForResult } from "lucent:android";
import { main } from "lucent:thread";
import { delay } from "lucent:core";

// The last pick, which outlives the screen: the app's Activity may be
// recreated while the picker is open, and its React tree with it.
let last: string | null = null;

/** The picked document's URI, or null if the person backed out (or on iOS). */
export async function pickDocumentAsync(signal?: AbortSignal): Promise<string | null> {
  if (PLATFORM !== "android") return null;

  const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
  intent.addCategory(Intent.CATEGORY_OPENABLE);
  intent.setType("*/*");

  const result = await startActivityForResult(intent, signal);
  last =
    result.getResultCode() === Activity.RESULT_OK
      ? (result.getResultData()?.getDataString() ?? null)
      : null;

  return last;
}

/** The last document picked since the app started, if any. */
export async function lastPickedAsync(): Promise<string | null> {
  return last;
}

/**
 * Recreates the app's Activity (as a configuration change would) after
 * `ms`: with the picker open, the answer still arrives.
 */
export async function recreateActivityAfter(ms: number): Promise<boolean> {
  if (PLATFORM !== "android") return false;

  await delay(ms);

  return main(() => {
    const activity = currentActivity();
    activity?.recreate();

    return activity !== null;
  });
}

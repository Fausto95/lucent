import { PLATFORM } from "lucent:platform";
import { UIPasteboard } from "lucent:ios/UIKit";
import { ClipboardManager, ClipDescription } from "lucent:android/android.content";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";

export async function hasStringAsync(): Promise<boolean> {
  if (PLATFORM === "ios") {
    return UIPasteboard.general.hasStrings;
  } else {
    return main(
      () =>
        appContext()
          .getSystemService(ClipboardManager)
          ?.getPrimaryClipDescription()
          ?.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ?? false,
    );
  }
}

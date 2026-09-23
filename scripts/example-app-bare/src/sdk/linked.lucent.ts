// Libraries the app already links, bound like the SDK: React Native's own
// pods on iOS, AndroidX on Android. Nothing is added to the app for it.
import { PLATFORM } from "lucent:platform";
import { RCTAppDependencyProvider } from "lucent:ios/ReactAppDependencyProvider";
import { ContextCompat } from "lucent:android/androidx.core.content";
import { PackageManager } from "lucent:android/android.content.pm";
import { appContext } from "lucent:android";

export async function linkedLibraries(): Promise<string> {
  if (PLATFORM === "ios") {
    const provider = new RCTAppDependencyProvider();
    return `${provider.urlRequestHandlerClassNames().length} request handlers, ${provider.imageDataDecoderClassNames().length} image decoders`;
  } else {
    const internet = ContextCompat.checkSelfPermission(appContext(), "android.permission.INTERNET");
    return `INTERNET granted ${internet === PackageManager.PERMISSION_GRANTED}`;
  }
}

import { ContextCompat } from "lucent:android/androidx.core.content";
import { PackageManager } from "lucent:android/android.content.pm";
import { appContext } from "lucent:android";

export async function linkedLibraries(): Promise<string> {
  const internet = ContextCompat.checkSelfPermission(appContext(), "android.permission.INTERNET");
  return `INTERNET granted ${internet === PackageManager.PERMISSION_GRANTED}`;
}

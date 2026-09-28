// Biometric sign-in that can be withdrawn: LAContext.evaluatePolicy on iOS
// (Face ID or Touch ID, then the passcode), with an AbortSignal that
// invalidates the context. On Android, the system's confirm-credential
// screen (the device's biometrics or its screen lock), started for a result
// from the Activity in front; aborting withdraws the request, and Lucent
// closes the screen it started.
import { PLATFORM } from "lucent:platform";
import { LAContext, LAError_Code, LAPolicy } from "lucent:ios/LocalAuthentication";
import { Activity, KeyguardManager } from "lucent:android/android.app";
import { appContext, startActivityForResult } from "lucent:android";
import { errorCode } from "lucent:core";

export interface SignInResult {
  success: boolean;
  /** Why not: cancelled, not_enrolled, not_available, lockout, failed. */
  error: string | null;
}

const IOS_ERRORS: [number, string][] = [
  [LAError_Code.userCancel, "cancelled"],
  [LAError_Code.appCancel, "cancelled"],
  [LAError_Code.systemCancel, "cancelled"],
  [LAError_Code.touchIDNotEnrolled, "not_enrolled"],
  [LAError_Code.passcodeNotSet, "not_enrolled"],
  [LAError_Code.touchIDNotAvailable, "not_available"],
  [LAError_Code.touchIDLockout, "lockout"],
  [LAError_Code.authenticationFailed, "failed"],
];

/** An LAError's name, from the Lucent error made of its NSError ("<domain>:<code>"). */
function iosError(e: Error): string {
  const code = errorCode(e) ?? "";
  const number = Number(code.slice(code.lastIndexOf(":") + 1));

  return IOS_ERRORS.find(([c]) => c === number)?.[1] ?? `error ${code}`;
}

/** Asks the person to authenticate; aborting `signal` withdraws the prompt. */
export async function authenticateAsync(
  reason: string,
  signal?: AbortSignal,
): Promise<SignInResult> {
  if (PLATFORM === "android") return androidAuthenticate(reason, signal);

  const context = new LAContext();
  if (signal) signal.addEventListener("abort", () => context.invalidate());

  try {
    return {
      success: await context.evaluatePolicy(LAPolicy.deviceOwnerAuthentication, reason),
      error: null,
    };
  } catch (e) {
    return { success: false, error: iosError(e as Error) };
  }
}

/** The screen lock's confirm-credential screen, for a result. */
async function androidAuthenticate(reason: string, signal?: AbortSignal): Promise<SignInResult> {
  const keyguard = appContext().getSystemService(KeyguardManager);
  if (!keyguard?.isDeviceSecure()) return { success: false, error: "not_enrolled" };

  const intent = keyguard.createConfirmDeviceCredentialIntent("Lucent example", reason);
  if (!intent) return { success: false, error: "not_available" };

  try {
    const result = await startActivityForResult(intent, signal);
    const ok = result.getResultCode() === Activity.RESULT_OK;

    return { success: ok, error: ok ? null : "cancelled" };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { success: false, error: "cancelled" };
    throw e;
  }
}

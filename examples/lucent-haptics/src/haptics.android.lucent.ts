// expo-haptics' HapticsModule.kt: vibration patterns through the Vibrator.
import { VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
import { error } from "@lucent-lang/core";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "./hapticsTypes.lucent";

type VibrationType = { timings: number[]; amplitudes: number[]; oldSDKPattern: number[] };

function impactType(style: ImpactFeedbackStyle): VibrationType {
  switch (style) {
    case ImpactFeedbackStyle.Light:
    case ImpactFeedbackStyle.Soft:
      return { timings: [0, 50], amplitudes: [0, 30], oldSDKPattern: [0, 20] };
    case ImpactFeedbackStyle.Medium:
    case ImpactFeedbackStyle.Rigid:
      return { timings: [0, 43], amplitudes: [0, 50], oldSDKPattern: [0, 43] };
    case ImpactFeedbackStyle.Heavy:
      return { timings: [0, 60], amplitudes: [0, 70], oldSDKPattern: [0, 61] };
  }
}

function notificationType(type: NotificationFeedbackType): VibrationType {
  switch (type) {
    case NotificationFeedbackType.Success:
      return { timings: [0, 40, 100, 40], amplitudes: [0, 50, 0, 60], oldSDKPattern: [0, 40, 100, 40] };
    case NotificationFeedbackType.Warning:
      return { timings: [0, 40, 120, 60], amplitudes: [0, 40, 0, 60], oldSDKPattern: [0, 40, 120, 60] };
    case NotificationFeedbackType.Error:
      return { timings: [0, 60, 100, 40, 80, 50], amplitudes: [0, 50, 0, 40, 0, 50], oldSDKPattern: [0, 60, 100, 40, 80, 50] };
  }
}

const selectionType: VibrationType = { timings: [0, 50], amplitudes: [0, 30], oldSDKPattern: [0, 70] };

function vibrator(): Vibrator {
  const context = appContext();
  const v = available("android", 31) ? context.getSystemService(VibratorManager)?.defaultVibrator : context.getSystemService(Vibrator);
  if (!v) throw error("E_HAPTICS_NOT_SUPPORTED", "A haptics engine is not available on this device");
  return v;
}

function vibrate(type: VibrationType): void {
  if (available("android", 26)) {
    vibrator().vibrate(VibrationEffect.createWaveform(type.timings, type.amplitudes, -1));
  } else {
    vibrator().vibrate(type.oldSDKPattern, -1);
  }
}

export async function notificationAsync(type: NotificationFeedbackType = NotificationFeedbackType.Success): Promise<void> {
  vibrate(notificationType(type));
}

export async function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  vibrate(impactType(style));
}

export async function selectionAsync(): Promise<void> {
  vibrate(selectionType);
}

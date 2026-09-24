// expo-haptics' API, implemented in Lucent per platform (the M2.0 parity
// port): HapticsModule.swift's feedback generators, on the main thread, and
// HapticsModule.kt's vibration patterns through the Vibrator.
import { PLATFORM } from "lucent:platform";
import {
  UIImpactFeedbackGenerator,
  UIImpactFeedbackGenerator_FeedbackStyle as FeedbackStyle,
  UINotificationFeedbackGenerator,
  UINotificationFeedbackGenerator_FeedbackType as FeedbackType,
  UISelectionFeedbackGenerator,
} from "lucent:ios/UIKit";
import { VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
import { main } from "lucent:thread";
import { error } from "lucent:core";

export enum ImpactFeedbackStyle {
  Light = "light",
  Medium = "medium",
  Heavy = "heavy",
  Soft = "soft",
  Rigid = "rigid",
}

export enum NotificationFeedbackType {
  Success = "success",
  Warning = "warning",
  Error = "error",
}

// --- iOS ---------------------------------------------------------------------

function feedbackStyle(style: ImpactFeedbackStyle): FeedbackStyle {
  switch (style) {
    case ImpactFeedbackStyle.Light:
      return FeedbackStyle.light;
    case ImpactFeedbackStyle.Medium:
      return FeedbackStyle.medium;
    case ImpactFeedbackStyle.Heavy:
      return FeedbackStyle.heavy;
    case ImpactFeedbackStyle.Soft:
      return FeedbackStyle.soft;
    case ImpactFeedbackStyle.Rigid:
      return FeedbackStyle.rigid;
  }
}

function feedbackType(type: NotificationFeedbackType): FeedbackType {
  switch (type) {
    case NotificationFeedbackType.Success:
      return FeedbackType.success;
    case NotificationFeedbackType.Warning:
      return FeedbackType.warning;
    case NotificationFeedbackType.Error:
      return FeedbackType.error;
  }
}

// --- Android -----------------------------------------------------------------

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

// --- The module --------------------------------------------------------------

export async function notificationAsync(type: NotificationFeedbackType = NotificationFeedbackType.Success): Promise<void> {
  if (PLATFORM === "ios") {
    return main(() => {
      const generator = new UINotificationFeedbackGenerator();
      generator.prepare();
      generator.notificationOccurred(feedbackType(type));
    });
  } else {
    vibrate(notificationType(type));
  }
}

export async function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  if (PLATFORM === "ios") {
    return main(() => {
      const generator = new UIImpactFeedbackGenerator(feedbackStyle(style));
      generator.prepare();
      generator.impactOccurred();
    });
  } else {
    vibrate(impactType(style));
  }
}

export async function selectionAsync(): Promise<void> {
  if (PLATFORM === "ios") {
    return main(() => {
      const generator = new UISelectionFeedbackGenerator();
      generator.prepare();
      generator.selectionChanged();
    });
  } else {
    vibrate(selectionType);
  }
}

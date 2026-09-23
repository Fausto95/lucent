// expo-haptics' HapticsModule.swift: feedback generators, on the main thread.
import {
  UIImpactFeedbackGenerator,
  UIImpactFeedbackGenerator_FeedbackStyle as FeedbackStyle,
  UINotificationFeedbackGenerator,
  UINotificationFeedbackGenerator_FeedbackType as FeedbackType,
  UISelectionFeedbackGenerator,
} from "lucent:ios/UIKit";
import { main } from "lucent:thread";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "./hapticsTypes.lucent";

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

export function notificationAsync(type: NotificationFeedbackType = NotificationFeedbackType.Success): Promise<void> {
  return main(() => {
    const generator = new UINotificationFeedbackGenerator();
    generator.prepare();
    generator.notificationOccurred(feedbackType(type));
  });
}

export function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  return main(() => {
    const generator = new UIImpactFeedbackGenerator(feedbackStyle(style));
    generator.prepare();
    generator.impactOccurred();
  });
}

export function selectionAsync(): Promise<void> {
  return main(() => {
    const generator = new UISelectionFeedbackGenerator();
    generator.prepare();
    generator.selectionChanged();
  });
}

// Experiment only: UIKit's schema in the export.
import { PLATFORM } from "lucent:platform";
import { UIView } from "lucent:ios/UIKit";

export function label(): string {
  if (PLATFORM !== "ios") return "";
  return new UIView().accessibilityLabel ?? "none";
}

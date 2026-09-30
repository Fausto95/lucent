import { Platform, Settings } from "react-native";

/**
 * The route automation asked for at launch, on iOS:
 * `xcrun simctl launch <device> <bundle> -lucentTab lab/tests`
 * (launch arguments become user defaults, which Settings reads).
 */
export function launchArgument(): string | null {
  if (Platform.OS !== "ios") return null;

  const value: unknown = Settings.get("lucentTab");

  return typeof value === "string" ? value : null;
}

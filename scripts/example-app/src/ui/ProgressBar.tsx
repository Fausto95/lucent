import { StyleSheet, View } from "react-native";
import { radius } from "./theme";
import { useTheme } from "./useTheme";

/** How much of something is done, from 0 to 1. */
export function ProgressBar({ value }: { value: number }) {
  const { colors } = useTheme();

  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
    >
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.sm, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.sm },
});

import { StyleSheet, Text, View } from "react-native";
import { radius, type } from "./theme";
import { useTheme } from "./useTheme";

/** The first letters of a title's first two words, on a tile. */
export function Monogram({ text }: { text: string }) {
  const { colors } = useTheme();

  const letters = text
    .split(/[\s&]+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.tile, { backgroundColor: colors.accentSoft }]}
    >
      <Text style={[type.headline, { color: colors.accent }]}>{letters}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});

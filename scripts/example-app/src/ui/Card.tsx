import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  title?: string;
  children: ReactNode;
}

/** A group of related content on a raised surface. */
export function Card({ title, children }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {title ? (
        <Text accessibilityRole="header" style={[type.caption, { color: colors.textFaint }]}>
          {title}
        </Text>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
});

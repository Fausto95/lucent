import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

export type ButtonVariant = "primary" | "secondary" | "danger";

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and ignores presses. */
  busy?: boolean;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  testID,
  accessibilityHint,
}: Props) {
  const { colors } = useTheme();

  const palette = {
    primary: { background: colors.accent, text: colors.onAccent },
    secondary: { background: colors.accentSoft, text: colors.accent },
    danger: { background: colors.dangerSoft, text: colors.danger },
  }[variant];

  const inactive = disabled || busy;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.background },
        (pressed || inactive) && styles.dimmed,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={palette.text} /> : null}

      <Text style={[type.headline, styles.label, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  label: { fontSize: 15 },
  dimmed: { opacity: 0.55 },
});

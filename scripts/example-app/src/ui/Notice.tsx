import { StyleSheet, Text, View } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

export type Tone = "info" | "success" | "warning" | "danger";

interface Props {
  tone?: Tone;
  title: string;
  message?: string;
  testID?: string;
}

/** A short status message: a result, or why something is not available here. */
export function Notice({ tone = "info", title, message, testID }: Props) {
  const { colors } = useTheme();

  const palette = {
    info: { background: colors.accentSoft, text: colors.accent },
    success: { background: colors.successSoft, text: colors.success },
    warning: { background: colors.warningSoft, text: colors.warning },
    danger: { background: colors.dangerSoft, text: colors.danger },
  }[tone];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: palette.background }]}
    >
      <Text style={[type.headline, { color: palette.text }]}>{title}</Text>

      {message ? <Text style={[type.callout, { color: colors.text }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { borderRadius: radius.md, padding: space.md, gap: space.xs },
});

import { StyleSheet, Text } from "react-native";
import { type } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  text: string;
  /** Unknown while running. */
  ok?: boolean;
}

/** A Lab screen's verdict: the line automation reads (testID lucent-summary). */
export function SummaryLine({ text, ok }: Props) {
  const { colors } = useTheme();

  const color = ok === undefined ? colors.textMuted : ok ? colors.success : colors.danger;

  return (
    <Text
      testID="lucent-summary"
      accessibilityLiveRegion="polite"
      style={[type.title, styles.line, { color }]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 20 },
});

import { StyleSheet, Text, View } from "react-native";
import { space, type } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  label: string;
  value: string;
  /** Monospaced, for hashes, paths and other machine values. */
  code?: boolean;
  testID?: string;
}

/** A label and its value, side by side (stacked for code values). */
export function InfoRow({ label, value, code = false, testID }: Props) {
  const { colors } = useTheme();

  return (
    <View
      style={code ? styles.stacked : styles.row}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[type.callout, { color: colors.textMuted }]}>{label}</Text>

      <Text
        testID={testID}
        selectable
        style={[
          code ? type.code : type.callout,
          styles.value,
          { color: colors.text },
          !code && styles.end,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  stacked: { gap: space.xs },
  value: { flexShrink: 1 },
  end: { textAlign: "right", fontWeight: "600" },
});

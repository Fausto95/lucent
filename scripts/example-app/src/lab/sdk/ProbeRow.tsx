import { StyleSheet, Text, View } from "react-native";
import { StatusPill } from "../../ui/StatusPill";
import { radius, space, type } from "../../ui/theme";
import { useTheme } from "../../ui/useTheme";
import type { ProbeResult } from "./runProbe";

/** One probe: its verdict and its answer (against the expected one when it failed). */
export function ProbeRow({ result }: { result: ProbeResult }) {
  const { colors } = useTheme();

  return (
    <View
      testID={`probe-${result.name}`}
      accessible
      accessibilityLabel={`${result.name}, ${result.pass ? "passed" : "failed"}: ${result.got}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.title}>
        <StatusPill pass={result.pass} />

        <Text style={[type.headline, styles.name, { color: colors.text }]}>{result.name}</Text>

        <Text style={[type.callout, { color: colors.textFaint }]}>{result.ms} ms</Text>
      </View>

      <Text
        selectable
        style={[type.code, { color: result.pass ? colors.textMuted : colors.danger }]}
      >
        {result.pass ? result.got : `expected: ${result.expected}\n     got: ${result.got}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  title: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flex: 1 },
});

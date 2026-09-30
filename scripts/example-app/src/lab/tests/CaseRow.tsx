import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusPill } from "../../ui/StatusPill";
import { radius, space, type } from "../../ui/theme";
import { useTheme } from "../../ui/useTheme";
import type { CaseResult } from "./runCase";

/** One case: its verdict, and its lines against the expected ones (open when it failed). */
export function CaseRow({ result }: { result: CaseResult }) {
  const { colors } = useTheme();

  const [open, setOpen] = useState(false);

  const extra = result.lines.slice(result.expected.length);

  return (
    <Pressable
      testID={`case-${result.name}`}
      accessibilityRole="button"
      accessibilityLabel={`${result.name}, ${result.pass ? "passed" : "failed"}`}
      accessibilityState={{ expanded: open || !result.pass }}
      onPress={() => setOpen(!open)}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.title}>
        <StatusPill pass={result.pass} />

        <Text style={[type.headline, styles.name, { color: colors.text }]}>{result.name}</Text>

        <Text style={[type.callout, { color: colors.textFaint }]}>{result.ms} ms</Text>
      </View>

      {result.error ? (
        <Text style={[type.code, { color: colors.danger }]}>{result.error}</Text>
      ) : null}

      {open || !result.pass ? (
        <View style={styles.lines}>
          {result.expected.map((expected, i) => {
            const got = result.lines[i];
            const same = got === expected;

            return (
              <Text
                key={i}
                selectable
                style={[type.code, { color: same ? colors.textMuted : colors.danger }]}
              >
                {same ? got : `expected: ${expected}\n     got: ${got ?? "(nothing)"}`}
              </Text>
            );
          })}

          {extra.map((line, i) => (
            <Text key={`extra-${i}`} style={[type.code, { color: colors.danger }]}>
              extra: {line}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
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
  lines: { gap: 2 },
});

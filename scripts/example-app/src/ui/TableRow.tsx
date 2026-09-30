import { StyleSheet, Text, View } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  /** The row's name, then its values. */
  cells: readonly string[];
  header?: boolean;
  /** Colors the name: green for Lucent's own row, red for a failure. */
  tone?: "success" | "danger";
  /** Colors the last value, e.g. a speedup. */
  emphasizeLast?: boolean;
  testID?: string;
}

/** A row of a results table: a name, then right-aligned numbers. */
export function TableRow({ cells, header = false, tone, emphasizeLast = false, testID }: Props) {
  const { colors } = useTheme();

  const [name, ...values] = cells;

  const nameColor =
    tone === "success" ? colors.success : tone === "danger" ? colors.danger : colors.text;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={cells.join(", ")}
      style={[
        styles.row,
        header ? styles.header : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          header ? type.callout : type.headline,
          styles.name,
          { color: header ? colors.textFaint : nameColor },
        ]}
      >
        {name}
      </Text>

      {values.map((value, i) => (
        <Text
          key={i}
          style={[
            type.code,
            styles.value,
            { color: header ? colors.textFaint : colors.text },
            emphasizeLast &&
              i === values.length - 1 &&
              !header && [styles.strong, { color: colors.success }],
          ]}
        >
          {value}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { paddingVertical: 0, borderWidth: 0 },
  name: { flex: 1.4 },
  value: { flex: 1, textAlign: "right", fontSize: 13 },
  strong: { fontWeight: "700" },
});

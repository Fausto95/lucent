import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

/** One choice among a few, as tabs. */
export function SegmentedControl<T extends string>({ options, value, onChange, testID }: Props<T>) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            testID={testID ? `${testID}-${option.value}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: colors.surface }]}
          >
            <Text
              style={[
                type.headline,
                styles.label,
                { color: selected ? colors.text : colors.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderRadius: radius.md, padding: 3 },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    borderRadius: radius.sm + 2,
    paddingHorizontal: space.sm,
  },
  label: { fontSize: 15 },
});

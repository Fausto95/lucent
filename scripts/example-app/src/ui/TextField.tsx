import { StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, type } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  multiline?: boolean;
  testID?: string;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  multiline = false,
  testID,
}: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[type.callout, { color: colors.textMuted }]}>{label}</Text>

      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          type.body,
          styles.input,
          multiline && styles.multiline,
          { color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  input: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
});

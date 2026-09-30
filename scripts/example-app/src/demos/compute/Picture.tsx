import { Image, StyleSheet, Text, View } from "react-native";
import { radius, space, type } from "../../ui/theme";
import { useTheme } from "../../ui/useTheme";

/** A BMP image from base64, with a caption. */
export function Picture({ label, base64 }: { label: string; base64: string }) {
  const { colors } = useTheme();

  return (
    <View style={styles.picture}>
      <Image
        accessibilityLabel={label}
        source={{ uri: `data:image/bmp;base64,${base64}` }}
        style={[styles.image, { backgroundColor: colors.surfaceMuted }]}
      />

      <Text style={[type.callout, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  picture: { flex: 1, gap: space.xs, alignItems: "center" },
  image: { width: "100%", aspectRatio: 1, borderRadius: radius.sm },
});

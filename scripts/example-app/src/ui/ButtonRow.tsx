import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { space } from "./theme";

/** Buttons side by side, wrapping onto new lines when they do not fit. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});

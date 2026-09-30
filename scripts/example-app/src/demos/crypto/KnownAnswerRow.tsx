import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { StatusPill } from "../../ui/StatusPill";
import { space, type } from "../../ui/theme";
import { useTheme } from "../../ui/useTheme";
import { describeError } from "../describeError";
import type { KnownAnswer } from "./knownAnswers";

/** A test vector, run once: PASS when the platform reproduces it. */
export function KnownAnswerRow({ answer }: { answer: KnownAnswer }) {
  const { colors } = useTheme();

  const [got, setGot] = useState<string | null>(null);

  useEffect(() => {
    answer.run().then(setGot, (e: unknown) => setGot(describeError(e)));
  }, [answer]);

  return (
    <View style={styles.row}>
      <View style={styles.title}>
        {got === null ? null : <StatusPill pass={got === answer.expected} />}

        <Text style={[type.callout, styles.name, { color: colors.text }]}>{answer.name}</Text>
      </View>

      <Text selectable style={[type.code, { color: colors.textMuted }]}>
        {got ?? "…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.xs },
  title: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { flex: 1, fontWeight: "600" },
});

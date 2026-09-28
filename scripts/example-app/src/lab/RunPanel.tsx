import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Notice } from "../ui/Notice";
import { SummaryLine } from "../ui/SummaryLine";
import { space, type } from "../ui/theme";
import { useTheme } from "../ui/useTheme";

interface Props {
  running: boolean;
  /** The verdict once the run is over. */
  result: { text: string; ok: boolean } | null;
  /** Where the run is, e.g. "12/23 run · 12 passed". */
  progress: string;
  onRun: () => void;
  /** Timings only mean something in Release builds. */
  timed?: boolean;
}

/** A Lab screen's header: its verdict, progress, and a way to run it again. */
export function RunPanel({ running, result, progress, onRun, timed = false }: Props) {
  const { colors } = useTheme();

  return (
    <Card>
      <SummaryLine
        text={running ? "Running…" : (result?.text ?? "")}
        ok={running ? undefined : result?.ok}
      />

      <Text style={[type.callout, { color: colors.textMuted }]}>{progress}</Text>

      {timed && __DEV__ ? (
        <Notice
          tone="warning"
          title="Debug build"
          message="Use a Release build for representative numbers."
        />
      ) : null}

      <View style={styles.actions}>
        <Button
          testID="lab-run"
          label="Run again"
          variant="secondary"
          busy={running}
          onPress={onRun}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", marginTop: space.xs },
});

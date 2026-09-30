import { Text } from "react-native";
import type { NetInfoState } from "../../sdk/netInfo.lucent";
import { type } from "../../ui/theme";
import { useTheme } from "../../ui/useTheme";

export interface LoggedState {
  id: number;
  state: NetInfoState;
  /** A change the listener reported, or an explicit fetch. */
  source: "listener" | "fetch";
  at: Date;
}

/** The latest network states, newest first. */
export function StateLog({ entries }: { entries: readonly LoggedState[] }) {
  const { colors } = useTheme();

  if (entries.length === 0)
    return <Text style={[type.callout, { color: colors.textMuted }]}>No updates yet.</Text>;

  return (
    <>
      {entries.map((entry) => (
        <Text key={entry.id} style={[type.code, { color: colors.text }]}>
          {entry.at.toLocaleTimeString()} {entry.source.padEnd(8)} {entry.state.type}
          {entry.state.isConnected ? "" : " (offline)"}
        </Text>
      ))}
    </>
  );
}

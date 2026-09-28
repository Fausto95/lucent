import { Screen } from "../ui/Screen";
import type { LabEntry } from "./catalog";

export function LabScreen({ entry, onBack }: { entry: LabEntry; onBack: () => void }) {
  return (
    <Screen title={entry.title} subtitle={entry.summary} onBack={onBack}>
      <entry.Screen />
    </Screen>
  );
}

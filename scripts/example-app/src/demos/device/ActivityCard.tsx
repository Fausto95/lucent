import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { CodeBlock } from "../../ui/CodeBlock";
import { InfoRow } from "../../ui/InfoRow";
import { currentActivityAsync, lifecycleEvents, watchLifecycle } from "./activity.lucent";

/** The Activity in front, and the latest lifecycle events of the app's Activities (Android). */
export function ActivityCard() {
  const [name, setName] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  async function refresh() {
    setName(await currentActivityAsync());
    setEvents(lifecycleEvents());
  }

  useEffect(() => {
    watchLifecycle();
    void refresh();
  }, []);

  if (Platform.OS !== "android") return null;

  return (
    <Card title="Activity">
      <InfoRow testID="activity-current" label="In front" value={name ?? "none"} />

      <CodeBlock text={events.length ? events.join("\n") : "No lifecycle events yet"} />

      <Button testID="activity-refresh" label="Refresh" onPress={() => void refresh()} />
    </Card>
  );
}

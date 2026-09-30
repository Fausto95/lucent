import { Screen } from "../ui/Screen";
import { AboutDemo } from "./AboutDemo";
import type { Demo } from "./catalog";

export function DemoScreen({ demo, onBack }: { demo: Demo; onBack: () => void }) {
  return (
    <Screen title={demo.title} subtitle={demo.summary} onBack={onBack}>
      <AboutDemo demo={demo} />

      <demo.Screen />
    </Screen>
  );
}

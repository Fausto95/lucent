import { Platform } from "react-native";
import { demos } from "../demos/catalog";
import { lab } from "../lab/catalog";
import type { Route, Section } from "../navigation/routes";
import { ListRow } from "../ui/ListRow";
import { Screen } from "../ui/Screen";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Stack } from "../ui/Stack";

const SECTIONS = [
  { value: "examples", label: "Examples" },
  { value: "lab", label: "Lab" },
] as const;

const INTRO: Record<Section, string> = {
  examples:
    "Native modules written in TypeScript, compiled to C++ by Lucent. Each example is one module and one screen.",
  lab: "The checks behind the examples: every language feature, platform binding and benchmark, run on this device.",
};

interface Props {
  section: Section;
  open: (route: Route) => void;
}

export function HomeScreen({ section, open }: Props) {
  const entries =
    section === "examples"
      ? demos.map((d) => ({
          id: d.id,
          title: d.title,
          summary: d.summary,
          route: { screen: "demo", id: d.id } as const,
        }))
      : lab.map((l) => ({
          id: l.id,
          title: l.title,
          summary: l.summary,
          route: { screen: "lab", id: l.id } as const,
        }));

  return (
    <Screen
      title="Lucent"
      subtitle={`${INTRO[section]} Running on ${Platform.OS === "ios" ? "iOS" : "Android"}.`}
    >
      <SegmentedControl
        testID="home-section"
        options={SECTIONS}
        value={section}
        onChange={(next) => open({ screen: "home", section: next })}
      />

      <Stack>
        {entries.map((entry) => (
          <ListRow
            key={entry.id}
            testID={`open-${entry.id}`}
            title={entry.title}
            subtitle={entry.summary}
            onPress={() => open(entry.route)}
          />
        ))}
      </Stack>
    </Screen>
  );
}

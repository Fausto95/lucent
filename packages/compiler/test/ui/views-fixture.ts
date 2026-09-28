/**
 * Four components for the Fabric and proxy tests: a label (`Caption`), a
 * control (`Gauge`) with every kind of prop, events (a coalesced one among
 * them) and commands, `Picker`, whose names meet the generated code's (a
 * prop named like the props' struct, two props with one C++ spelling, a
 * parameter named like its event's struct or like the property React
 * Native adds to payloads), whose object prop holds an enum and an object,
 * and whose event is continuous, and `Card`, which takes React children in
 * its slot.
 */
import type { ComponentDescription } from "../../src/ui/contract.ts";
import { views } from "./fixture.ts";

export const SOURCE = `import { Label, View } from "./native";
import { type Children, type Coalesced, type Continuous, expose, slot } from "./ui";

type Point = { x: number; y?: number | null };

export function Caption(props: { text: string; detail?: string | null }): Label {
  const label = new Label();
  label.text = props.text;
  return label;
}

export function Gauge(props: {
  value: number;
  enabled?: boolean;
  mode: "linear" | "radial";
  points: Point[];
  tags?: (string | null)[];
  "aria-label"?: string;
  onChange?: (value: number, source?: string) => void;
  onReset: () => void;
  onDrag?: Coalesced<(offset: number) => void>;
}): Label {
  const label = new Label();
  label.text = String(props.value);
  expose({
    reset: () => {
      label.text = "";
    },
    measure: (unit: "pt" | "px"): number => 0,
    flush: async (): Promise<void> => {},
  });
  return label;
}

export function Picker(props: {
  Values: number;
  "aria-label"?: string;
  aria_u2d_label?: string;
  range?: { unit: "pt" | "px"; bounds: { min: number } };
  onPick?: Continuous<(Event0: string, target?: string) => void>;
}): Label {
  const label = new Label();
  label.text = String(props.Values);
  return label;
}

export function Card(props: { title: string; children?: Children }): Label {
  const label = new Label();
  const content = slot<View>();
  label.text = props.title;
  content.title = props.title;
  return label;
}
`;

/** The fixture's descriptions: Caption, Gauge, Picker, then Card. */
export function components(): ComponentDescription[] {
  const a = views({ "ui.lucent.tsx": SOURCE });

  if (a.diagnostics.length) throw new Error(a.diagnostics.map((d) => d.message).join("\n"));

  return a.components;
}

export const CAPTION = "LucentCaption_90d454e99718";
export const GAUGE = "LucentGauge_9f3932d52a2f";
export const PICKER = "LucentPicker_8770a845170b";
export const CARD = "LucentCard_fd1aaeb7db45";

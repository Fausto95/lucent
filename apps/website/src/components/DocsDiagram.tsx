import type { ReactElement } from "react";
import type { DiagramName } from "../docs/types";
import { BuildDiagram } from "./diagrams/BuildDiagram";
import { CallDiagram } from "./diagrams/CallDiagram";
import { PlatformCallDiagram } from "./diagrams/PlatformCallDiagram";

const diagrams: Record<DiagramName, () => ReactElement> = {
  "build-check": () => <BuildDiagram step={1} />,
  "build-cpp": () => <BuildDiagram step={2} />,
  "build-package": () => <BuildDiagram step={3} />,
  "build-app": () => <BuildDiagram step={4} />,
  "build-metro": () => <BuildDiagram step={5} />,
  "call-sync": () => <CallDiagram mode="sync" />,
  "call-async": () => <CallDiagram mode="async" />,
  "platform-call": () => <PlatformCallDiagram />,
};

/** Renders a docs diagram by name, so pages stay plain data. */
export function DocsDiagram({ name }: { name: DiagramName }) {
  return diagrams[name]();
}

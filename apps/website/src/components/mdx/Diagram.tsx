/**
 * A docs diagram by name, with its caption (the element's content):
 * <Diagram name="threads">What runs where.</Diagram>. The diagrams are
 * hand-laid SVG (components/diagrams/*.tsx).
 */
import type { ReactNode } from "react";
import type { DiagramName } from "../../docs/types";
import { BuildDiagram } from "../diagrams/BuildDiagram";
import { CallDiagram } from "../diagrams/CallDiagram";
import { PlacesDiagram } from "../diagrams/PlacesDiagram";
import { PlatformCallDiagram } from "../diagrams/PlatformCallDiagram";
import { ThreadsDiagram } from "../diagrams/ThreadsDiagram";

const diagrams: Record<DiagramName, () => ReactNode> = {
  "build-check": () => <BuildDiagram step={1} />,
  "build-cpp": () => <BuildDiagram step={2} />,
  "build-package": () => <BuildDiagram step={3} />,
  "build-app": () => <BuildDiagram step={4} />,
  "build-metro": () => <BuildDiagram step={5} />,
  "call-sync": () => <CallDiagram mode="sync" />,
  "call-async": () => <CallDiagram mode="async" />,
  "platform-call": () => <PlatformCallDiagram />,
  places: () => <PlacesDiagram />,
  threads: () => <ThreadsDiagram />,
};

export default function Diagram({ name, children }: { name: DiagramName; children?: ReactNode }) {
  const draw = diagrams[name];
  if (!draw) throw new Error(`<Diagram name="${name}">: no such diagram`);
  return (
    <figure className="lucent-diagram">
      {draw()}
      {children && <figcaption>{children}</figcaption>}
    </figure>
  );
}

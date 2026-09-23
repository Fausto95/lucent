import type { ComponentType } from "react";
import type { DiagramName } from "../docs/types";
import { PipelineDiagram } from "./diagrams/PipelineDiagram";
import { RuntimeDiagram } from "./diagrams/RuntimeDiagram";

const diagrams: Record<DiagramName, ComponentType> = {
  pipeline: PipelineDiagram,
  runtime: RuntimeDiagram,
};

/** Renders a docs diagram by name, so pages stay plain data. */
export function DocsDiagram({ name }: { name: DiagramName }) {
  const Diagram = diagrams[name];
  return <Diagram />;
}

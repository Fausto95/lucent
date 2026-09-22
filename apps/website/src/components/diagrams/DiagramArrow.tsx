import { palette, type Point } from "./palette";

interface DiagramArrowProps {
  from: Point;
  to: Point;
  /** Marker id declared by the enclosing DiagramSvg. */
  marker: string;
  dashed?: boolean;
}

/** A straight connector with an arrowhead at `to`. */
export function DiagramArrow({ from, to, marker, dashed }: DiagramArrowProps) {
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      strokeWidth="1.25"
      strokeDasharray={dashed ? "4 4" : undefined}
      markerEnd={`url(#${marker})`}
      style={{ stroke: palette.line }}
    />
  );
}

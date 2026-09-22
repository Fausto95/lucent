import { FONT, palette } from "./palette";

interface DiagramNoteProps {
  x: number;
  y: number;
  lines: string[];
}

/** Muted multi-line annotation. */
export function DiagramNote({ x, y, lines }: DiagramNoteProps) {
  return (
    <text x={x} y={y} fontFamily={FONT} fontSize="11" style={{ fill: palette.muted }}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 0 : 15}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

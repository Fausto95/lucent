import { FONT, palette } from "./palette";

interface DiagramLaneProps {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** A shaded region grouping nodes that run in the same place (JS engine, native). */
export function DiagramLane({ x, y, w, h, label }: DiagramLaneProps) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill={palette.laneFill} stroke={palette.laneStroke} />
      <text x={x + 14} y={y + 20} fontFamily={FONT} fontSize="10.5" fill={palette.muted} letterSpacing="1">
        {label}
      </text>
    </g>
  );
}

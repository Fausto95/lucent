import { FONT, palette } from "./palette";

interface DiagramLabelProps {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle";
}

/** Small accent caption, used to name an arrow. */
export function DiagramLabel({ x, y, text, anchor = "middle" }: DiagramLabelProps) {
  return (
    <text
      x={x}
      y={y}
      fontFamily={FONT}
      fontSize="10.5"
      textAnchor={anchor}
      style={{ fill: palette.accent }}
    >
      {text}
    </text>
  );
}

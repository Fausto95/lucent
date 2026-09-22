import { FONT, palette } from "./palette";

interface DiagramBoxProps {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub?: string;
  accent?: boolean;
}

/** A rounded node with a label and an optional second, muted line. */
export function DiagramBox({ x, y, w, h = 44, label, sub, accent }: DiagramBoxProps) {
  const cx = x + w / 2;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="6"
        style={{
          fill: accent ? palette.accentFill : palette.boxFill,
          stroke: accent ? palette.accent : palette.boxStroke,
        }}
      />
      <text
        x={cx}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 4.5}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="12.5"
        style={{ fill: accent ? palette.accent : palette.text }}
      >
        {label}
      </text>
      {sub && (
        <text
          x={cx}
          y={y + h / 2 + 13}
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="10.5"
          style={{ fill: palette.muted }}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

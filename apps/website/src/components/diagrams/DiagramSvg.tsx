import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { styles } from "../DocsContent.stylex";
import { palette } from "./palette";

interface DiagramSvgProps {
  viewBox: string;
  title: string;
  /** Unique per diagram: the arrowhead marker id, referenced by every arrow inside. */
  markerId: string;
  children: ReactNode;
}

/** Responsive SVG shell with an accessible title and the arrowhead definition. */
export function DiagramSvg({ viewBox, title, markerId, children }: DiagramSvgProps) {
  return (
    <svg viewBox={viewBox} role="img" aria-label={title} {...stylex.props(styles.diagramSvg)}>
      <title>{title}</title>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" style={{ fill: palette.line }} />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

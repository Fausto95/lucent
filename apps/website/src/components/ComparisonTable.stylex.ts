import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  wrap: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderStrong,
    borderRadius: "8px",
    overflowX: "auto",
    margin: "24px 0",
    backgroundColor: tokens.bgRaised,
  },
  table: {
    borderCollapse: "separate",
    borderSpacing: 0,
    width: "100%",
    minWidth: "560px",
    tableLayout: "fixed",
    textAlign: "left",
    fontSize: "0.875rem",
    lineHeight: 1.5,
  },
  head: {
    padding: "16px 14px 12px",
    fontSize: "0.9375rem",
    fontWeight: 600,
    color: tokens.textSecondary,
    verticalAlign: "bottom",
  },
  headLucent: {
    color: tokens.accent,
    borderTopWidth: "2px",
    borderTopStyle: "solid",
    borderTopColor: tokens.accent,
  },
  label: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    padding: "12px 14px 0",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.6875rem",
    fontWeight: 500,
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    color: tokens.textSubtle,
    whiteSpace: "nowrap",
    overflow: "visible",
    zIndex: 2,
  },
  labelRest: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  cell: {
    padding: "6px 14px 14px",
    verticalAlign: "top",
  },
  /** The Lucent column stays put while the others scroll on narrow screens. */
  pinned: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    backgroundColor: tokens.surface,
    // The edge the scrolled columns pass under; only narrow screens scroll.
    boxShadow: {
      default: null,
      "@media (max-width: 720px)": `1px 0 0 ${tokens.borderStrong}`,
    },
  },
  columnLucent: {
    backgroundColor: tokens.surface,
  },
  value: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    color: tokens.text,
    fontWeight: 500,
  },
  detail: {
    display: "block",
    marginTop: "4px",
    fontSize: "0.8125rem",
    lineHeight: 1.55,
    color: tokens.textSubtle,
  },
  dot: {
    flexShrink: 0,
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    transform: "translateY(-1px)",
  },
  dotAvailable: {
    backgroundColor: tokens.accent,
  },
  dotPartial: {
    backgroundColor: tokens.warn,
  },
  dotPlanned: {
    backgroundColor: "transparent",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.textSubtle,
  },
});

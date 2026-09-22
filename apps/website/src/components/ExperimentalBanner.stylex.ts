import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  banner: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    marginTop: "14px",
    padding: {
      default: "12px 18px",
      "@media (max-width: 540px)": "10px 14px",
    },
    backgroundColor: tokens.warnSurface,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.warn,
    borderRadius: "0 5px 5px 0",
  },
  mark: {
    color: tokens.warn,
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: "0.9375rem",
    flexShrink: 0,
  },
  text: {
    margin: 0,
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 540px)": "0.8125rem",
    },
    lineHeight: 1.6,
    color: tokens.textSecondary,
  },
  label: {
    color: tokens.warn,
    fontWeight: 500,
  },
});

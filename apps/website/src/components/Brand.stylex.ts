import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: { default: 10, "@media (max-width: 540px)": 7 },
    color: tokens.text,
    fontSize: { default: "2rem", "@media (max-width: 540px)": "1.75rem" },
    fontWeight: 650,
    lineHeight: 1,
    letterSpacing: "-1.6px",
    flexShrink: 0,
  },
  compact: {
    gap: 8,
    fontSize: { default: "1.5625rem", "@media (max-width: 540px)": "1.4375rem" },
    letterSpacing: "-1.2px",
  },
  mark: {
    display: "block",
    width: { default: 40, "@media (max-width: 540px)": 34 },
    height: { default: 40, "@media (max-width: 540px)": 34 },
    flexShrink: 0,
  },
  compactMark: {
    width: 30,
    height: 30,
  },
  period: { color: tokens.accent },
});

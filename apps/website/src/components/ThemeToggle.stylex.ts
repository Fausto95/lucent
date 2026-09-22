import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: {
      default: "40px",
      "@media (max-width: 540px)": "34px",
    },
    height: {
      default: "40px",
      "@media (max-width: 540px)": "34px",
    },
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderStrong,
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: tokens.textSecondary,
    cursor: "pointer",
    transitionProperty: "color, border-color",
    transitionDuration: "0.2s",
    ":hover": {
      color: tokens.accent,
      borderColor: tokens.accent,
    },
  },
  icon: {
    width: "18px",
    height: "18px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
});

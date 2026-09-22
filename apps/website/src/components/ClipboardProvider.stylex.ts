import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  toast: {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translate(-50%, 20px)",
    opacity: 0,
    pointerEvents: "none",
    backgroundColor: tokens.accentFill,
    color: tokens.onAccent,
    padding: "12px 20px",
    borderRadius: "6px",
    fontSize: "0.875rem",
    boxShadow: `0 8px 35px ${tokens.shadowStrong}`,
    transitionProperty: "opacity, transform",
    transitionDuration: "0.2s, 0.2s",
  },
  visibleToast: {
    opacity: 1,
    transform: "translate(-50%, 0)",
  },
});

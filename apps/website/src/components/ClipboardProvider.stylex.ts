import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  toast: {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translate(-50%, 20px)",
    opacity: 0,
    pointerEvents: "none",
    backgroundColor: "#c4f778",
    color: "#182110",
    padding: "12px 20px",
    borderRadius: "6px",
    fontSize: "0.875rem",
    boxShadow: "0 8px 35px #0007",
    transitionProperty: "opacity, transform",
    transitionDuration: "0.2s, 0.2s",
  },
  visibleToast: {
    opacity: 1,
    transform: "translate(-50%, 0)",
  },
});

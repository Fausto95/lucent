import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  steps: {
    counterReset: "step",
    listStyle: "none",
    margin: "0",
    padding: "0",
    display: "grid",
    gap: "28px",
  },
  step: {
    display: "grid",
    gap: "12px",
  },
  stepTitle: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "17px",
    fontWeight: 600,
    margin: "0",
  },
  stepNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    borderRadius: "999px",
    backgroundColor: "#C4F778",
    color: "#111",
    fontSize: "13px",
    fontWeight: 700,
    flexShrink: 0,
  },
  hostTabs: {
    display: "grid",
    gap: "40px",
  },
});

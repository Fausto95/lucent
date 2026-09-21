import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  brandPeriod: {
    color: "#c4f778",
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: {
      default: "28px",
      "@media (max-width: 540px)": "18px",
    },
    padding: {
      default: "15px 20px",
      "@media (max-width: 540px)": "13px 15px",
    },
    borderRadius: "5px",
    fontSize: "0.875rem",
    fontWeight: 650,
    transitionProperty: "background-color, transform",
    transitionDuration: "0.2s, 0.2s",
    backgroundColor: "#c4f778",
    color: "#17210e",
    ":hover": {
      backgroundColor: "#d5ff9c",
      transform: "translateY(-2px)",
    },
  },
  buttonArrow: {
    fontSize: "1.25rem",
    fontWeight: 400,
  },
  howSection: {
    padding: {
      default: "82px 0 75px",
      "@media (max-width: 850px)": "55px 0",
    },
  },
  eyebrow2: {
    fontWeight: 500,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: {
      default: "1.3px",
      "@media (max-width: 540px)": "1px",
    },
    color: "#b8c0ae",
    display: "block",
  },
});

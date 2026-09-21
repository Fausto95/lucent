import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  section: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, .85fr) minmax(0, 1.15fr)",
      "@media (max-width: 950px)": "minmax(0, 1fr)",
    },
    gap: { default: "56px", "@media (max-width: 950px)": "20px" },
    paddingBlock: { default: "80px", "@media (max-width: 540px)": "44px" },
    borderTop: "1px solid #30362b",
    alignItems: "center",
  },
  copy: { minWidth: 0 },
  heading: {
    fontSize: "clamp(2.2rem, 3.8vw, 3.5rem)",
    fontWeight: 500,
    lineHeight: 1.12,
    letterSpacing: "-1.8px",
    marginBlock: "22px",
  },
  accent: { color: "#c4f778" },
  description: { color: "#d5dbce", fontSize: "1.12rem", lineHeight: 1.7, maxWidth: "42ch" },
  detail: { color: "#a0a79a", lineHeight: 1.8, maxWidth: "48ch" },
  targets: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px 24px",
    color: "#c4f778",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: ".8rem",
    marginBlock: "24px",
  },
  link: {
    display: "inline-flex",
    gap: "16px",
    color: "#c4f778",
    fontWeight: 500,
    textDecoration: "none",
    marginTop: "20px",
    ":hover": { textDecoration: "underline" },
  },
  note: { color: "#a0a79a", fontSize: ".8rem", lineHeight: 1.6, marginTop: "22px", maxWidth: "46ch" },
  code: { minWidth: 0 },
});

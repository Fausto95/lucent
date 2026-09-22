import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  section: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, .85fr) minmax(0, 1.15fr)",
      "@media (max-width: 950px)": "minmax(0, 1fr)",
    },
    gap: { default: "56px", "@media (max-width: 950px)": "20px" },
    paddingBlock: { default: "80px", "@media (max-width: 540px)": "44px" },
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
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
  accent: { color: tokens.accent },
  description: { color: tokens.textSecondary, fontSize: "1.12rem", lineHeight: 1.7, maxWidth: "42ch" },
  detail: { color: tokens.textMuted, lineHeight: 1.8, maxWidth: "48ch" },
  targets: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px 24px",
    color: tokens.accent,
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: ".8rem",
    marginBlock: "24px",
  },
  link: {
    display: "inline-flex",
    gap: "16px",
    color: tokens.accent,
    fontWeight: 500,
    textDecoration: "none",
    marginTop: "20px",
    ":hover": { textDecoration: "underline" },
  },
  note: { color: tokens.textMuted, fontSize: ".8rem", lineHeight: 1.6, marginTop: "22px", maxWidth: "46ch" },
  code: { minWidth: 0 },
});

import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

const mono = '"IBM Plex Mono", monospace';

export const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    height: {
      default: "40px",
      "@media (max-width: 540px)": "34px",
    },
    padding: "0 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderStrong,
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: tokens.textSecondary,
    fontSize: "0.85rem",
    cursor: "pointer",
    ":hover": {
      color: tokens.accent,
      borderColor: tokens.accent,
    },
  },
  label: {
    display: {
      default: "inline",
      "@media (max-width: 540px)": "none",
    },
  },
  key: {
    fontFamily: mono,
    fontSize: "0.7rem",
    color: tokens.textSubtle,
    display: {
      default: "inline",
      "@media (max-width: 540px)": "none",
    },
  },
  icon: {
    width: "16px",
    height: "16px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
  },
  dialog: {
    width: "min(640px, calc(100vw - 24px))",
    maxHeight: "min(560px, calc(100dvh - 48px))",
    marginTop: "10vh",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderStrong,
    borderRadius: "10px",
    backgroundColor: tokens.bgRaised,
    color: tokens.text,
    boxShadow: `0 20px 60px ${tokens.shadowStrong}`,
    "::backdrop": {
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "16px 18px",
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: "transparent",
    color: tokens.text,
    fontSize: "1rem",
    outline: "none",
  },
  results: {
    listStyle: "none",
    margin: 0,
    padding: "6px",
    overflowY: "auto",
    maxHeight: "min(480px, calc(100dvh - 130px))",
  },
  result: {
    display: "block",
    padding: "10px 12px",
    borderRadius: "6px",
    color: tokens.text,
    textDecoration: "none",
  },
  resultActive: {
    backgroundColor: tokens.surface,
  },
  resultTitle: {
    display: "block",
    fontSize: "0.9rem",
    fontWeight: 600,
  },
  resultHeading: {
    color: tokens.accent,
    fontWeight: 400,
  },
  resultSnippet: {
    display: "block",
    marginTop: "3px",
    fontSize: "0.8rem",
    lineHeight: 1.5,
    color: tokens.textMuted,
  },
  empty: {
    padding: "18px",
    fontSize: "0.85rem",
    color: tokens.textSubtle,
  },
});

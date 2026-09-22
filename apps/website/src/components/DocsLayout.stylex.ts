import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

const mono = '"IBM Plex Mono", monospace';
const border = tokens.border;
const accent = tokens.accent;

export const styles = stylex.create({
  layout: {
    display: {
      default: "grid",
      "@media (max-width: 850px)": "block",
    },
    gridTemplateColumns: {
      default: "220px minmax(0, 1fr) 190px",
      "@media (max-width: 1150px)": "200px minmax(0, 1fr)",
    },
    gap: {
      default: "56px",
      "@media (max-width: 1150px)": "36px",
    },
    padding: {
      default: "48px 0 72px",
      "@media (max-width: 850px)": "24px 0 56px",
    },
  },
  sidebar: {
    position: {
      default: "sticky",
      "@media (max-width: 850px)": "static",
    },
    top: "24px",
    maxHeight: {
      default: "calc(100dvh - 48px)",
      "@media (max-width: 850px)": "none",
    },
    overflowY: {
      default: "auto",
      "@media (max-width: 850px)": "visible",
    },
    alignSelf: "start",
    paddingBottom: {
      default: "24px",
      "@media (max-width: 850px)": "16px",
    },
    marginBottom: {
      default: 0,
      "@media (max-width: 850px)": "24px",
    },
    borderBottomWidth: {
      default: 0,
      "@media (max-width: 850px)": "1px",
    },
    borderBottomStyle: "solid",
    borderBottomColor: border,
  },
  sidebarSummary: {
    display: {
      default: "none",
      "@media (max-width: 850px)": "flex",
    },
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
    listStyle: "none",
    fontFamily: mono,
    fontSize: "0.75rem",
    letterSpacing: "1px",
    color: tokens.textMuted,
    padding: "10px 0",
    "::-webkit-details-marker": {
      display: "none",
    },
  },
  group: {
    marginBottom: "22px",
  },
  groupLabel: {
    fontFamily: mono,
    fontSize: "0.7rem",
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    color: tokens.textSubtle,
    margin: "0 0 8px 12px",
  },
  navLink: {
    display: "block",
    padding: "7px 12px",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: border,
    color: tokens.textMuted,
    fontSize: "0.9rem",
    lineHeight: 1.4,
    transitionProperty: "color, background-color, border-color",
    transitionDuration: "0.15s",
    ":hover": {
      color: accent,
      backgroundColor: tokens.surface,
      borderLeftColor: accent,
    },
  },
  navLinkActive: {
    color: accent,
    backgroundColor: tokens.surface,
    borderLeftColor: accent,
  },
  main: {
    minWidth: 0,
  },
  toc: {
    display: {
      default: "block",
      "@media (max-width: 1150px)": "none",
    },
    position: "sticky",
    top: "24px",
    alignSelf: "start",
    maxHeight: "calc(100dvh - 48px)",
    overflowY: "auto",
  },
  tocLabel: {
    fontFamily: mono,
    fontSize: "0.7rem",
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    color: tokens.textSubtle,
    margin: "0 0 10px",
  },
  tocLink: {
    display: "block",
    padding: "5px 0 5px 12px",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: border,
    color: tokens.textSubtle,
    fontSize: "0.8rem",
    lineHeight: 1.45,
    ":hover": {
      color: accent,
    },
  },
  tocLinkActive: {
    color: tokens.textSecondary,
    borderLeftColor: accent,
  },
  pager: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 540px)": "1fr",
    },
    gap: "14px",
    marginTop: "56px",
    paddingTop: "24px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: border,
  },
  pagerLink: {
    display: "block",
    padding: "14px 18px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderStrong,
    borderRadius: "7px",
    color: tokens.text,
    ":hover": {
      borderColor: accent,
    },
  },
  pagerNext: {
    textAlign: "right",
    gridColumn: {
      default: 2,
      "@media (max-width: 540px)": "auto",
    },
  },
  pagerLabel: {
    display: "block",
    fontFamily: mono,
    fontSize: "0.7rem",
    letterSpacing: "1px",
    color: tokens.textSubtle,
    marginBottom: "4px",
  },
  editLink: {
    display: "inline-block",
    marginTop: "28px",
    fontSize: "0.8rem",
    color: tokens.textSubtle,
    ":hover": {
      color: accent,
    },
  },
});

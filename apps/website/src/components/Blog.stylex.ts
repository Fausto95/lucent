import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

const mono = '"IBM Plex Mono", monospace';

export const styles = stylex.create({
  index: {
    maxWidth: "760px",
    padding: {
      default: "48px 0 72px",
      "@media (max-width: 850px)": "24px 0 56px",
    },
  },
  list: {
    listStyle: "none",
    margin: "36px 0 0",
    padding: 0,
  },
  item: {
    padding: "28px 0",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  itemTitle: {
    fontSize: {
      default: "1.5rem",
      "@media (max-width: 540px)": "1.3rem",
    },
    fontWeight: 500,
    letterSpacing: "-0.6px",
    lineHeight: 1.25,
    margin: "10px 0 8px",
  },
  itemLink: {
    color: tokens.text,
    transitionProperty: "color",
    transitionDuration: "0.15s",
    ":hover": {
      color: tokens.accent,
    },
  },
  date: {
    fontFamily: mono,
    fontSize: "0.75rem",
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    color: tokens.textSubtle,
  },
  // The post, then its table of contents: the docs' columns without the sidebar.
  post: {
    display: {
      default: "grid",
      "@media (max-width: 1150px)": "block",
    },
    gridTemplateColumns: "minmax(0, 820px) 190px",
    justifyContent: "space-between",
    gap: "56px",
    padding: {
      default: "48px 0 72px",
      "@media (max-width: 850px)": "24px 0 56px",
    },
  },
  article: {
    minWidth: 0,
  },
  back: {
    marginTop: "56px",
    paddingTop: "24px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    fontSize: "0.9rem",
  },
  backLink: {
    color: tokens.textSecondary,
    ":hover": {
      color: tokens.accent,
    },
  },
});

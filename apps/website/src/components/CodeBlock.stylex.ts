import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  referenceCode: {
    margin: "25px 0",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.borderStrong,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: tokens.borderStrong,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.borderStrong,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.borderStrong,
    borderRadius: "7px",
    backgroundColor: tokens.bgRaised,
    overflow: "hidden",
  },
  referenceCodeBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: {
      default: "16px",
      "@media (max-width: 540px)": "8px",
    },
    // Same inline padding as referencePre, so the file name lines up with the code.
    padding: {
      default: "10px 21px",
      "@media (max-width: 540px)": "8px 17px",
    },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    color: tokens.textMuted,
    fontWeight: 400,
    fontSize: "0.75rem",
    lineHeight: "normal",
    fontFamily: '"IBM Plex Mono", monospace',
  },
  referenceFileName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  /** In a tabbed block the tabs lead, so the file name sits beside the copy button. */
  referenceFileNameEnd: {
    marginLeft: "auto",
  },
  referenceCopyButton: {
    flexShrink: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: "6px",
    backgroundColor: "transparent",
    color: tokens.textSubtle,
    fontWeight: 500,
    fontSize: "0.6875rem",
    lineHeight: 1,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    fontFamily: '"IBM Plex Mono", monospace',
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 9px",
    cursor: "pointer",
    transitionProperty: "color, border-color",
    transitionDuration: "120ms",
    ":hover": {
      color: tokens.accent,
      borderColor: tokens.accent,
    },
    ":focus-visible": {
      outlineWidth: "2px",
      outlineStyle: "solid",
      outlineColor: tokens.accent,
      outlineOffset: "2px",
    },
  },
  referencePre: {
    padding: {
      default: "21px",
      "@media (max-width: 540px)": "17px",
    },
    margin: "0",
    overflow: "auto",
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 540px)": "0.8125rem",
    },
    tabSize: 2,
  },
  referenceCodeText: {
    fontWeight: 400,
    fontSize: "1em",
    lineHeight: 1.9,
    fontFamily: '"IBM Plex Mono", monospace',
    color: tokens.textCode,
    overflowWrap: "normal",
  },
  syntaxPurple: {
    color: tokens.syntaxKeyword,
  },
  syntaxYellow: {
    color: tokens.syntaxType,
  },
  syntaxGreen: {
    color: tokens.accent,
  },
  syntaxComment: {
    color: tokens.syntaxComment,
    fontStyle: "italic",
  },
  diffLine: {
    display: "block",
    marginInline: "-21px",
    paddingInline: "21px",
  },
  diffAdded: {
    backgroundColor: tokens.surfaceStrong,
  },
  diffRemoved: {
    backgroundColor: tokens.warnSurface,
  },
  diffMark: {
    display: "inline-block",
    width: "1.5ch",
    color: tokens.textSubtle,
    userSelect: "none",
  },
});

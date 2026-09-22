import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  hero: {
    display: "grid",
    gridTemplateColumns: {
      default: "1.08fr 1fr",
      "@media (max-width: 850px)": "1fr",
    },
    gap: {
      default: "64px",
      "@media (min-width: 1500px)": "100px",
      "@media (max-width: 1150px)": "35px",
      "@media (max-width: 850px)": "45px",
      "@media (max-width: 540px)": "30px",
    },
    alignItems: "center",
    padding: {
      default: "80px 0 66px",
      "@media (max-width: 850px)": "54px 0 45px",
    },
    paddingTop: {
      default: null,
      "@media (max-width: 1150px)": "60px",
      "@media (max-width: 540px)": "42px",
    },
  },
  heroCopy: {
    maxWidth: {
      default: null,
      "@media (max-width: 850px)": "610px",
    },
  },
  eyebrow: {
    fontWeight: 500,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
      "@media (max-width: 1150px)": "0.75rem",
      "@media (max-width: 850px)": "0.75rem",
    },
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: {
      default: "1.3px",
      "@media (max-width: 540px)": "0.3px",
      "@media (max-width: 1150px)": "1px",
    },
    color: tokens.textMuted,
    display: "flex",
    alignItems: "center",
    gap: {
      default: "9px",
      "@media (max-width: 540px)": "7px",
    },
    whiteSpace: "normal",
  },
  tinyMark: {
    color: tokens.accent,
    fontSize: {
      default: "1.5rem",
      "@media (max-width: 540px)": "1.25rem",
    },
    lineHeight: 1,
  },
  heroHeading: {
    fontSize: {
      default: "clamp(58px, 5.6vw, 81px)",
      "@media (min-width: 1500px)": "5.375rem",
      "@media (max-width: 1150px)": "4rem",
      "@media (max-width: 850px)": "4.75rem",
      "@media (max-width: 540px)": "clamp(47px, 11.7vw, 64px)",
    },
    fontWeight: 500,
    letterSpacing: {
      default: "-4.3px",
      "@media (max-width: 540px)": "-2.7px",
    },
    lineHeight: 1.07,
    margin: {
      default: "27px 0 25px",
      "@media (max-width: 540px)": "25px 0",
    },
  },
  heroDescription: {
    fontSize: {
      default: "1.625rem",
      "@media (max-width: 850px)": "1.5625rem",
      "@media (max-width: 540px)": "1.4375rem",
    },
    lineHeight: 1.4,
    letterSpacing: "-0.6px",
    margin: "0 0 18px",
  },
  heroDetail: {
    color: tokens.textMuted,
    fontSize: {
      default: "1rem",
      "@media (max-width: 540px)": "0.9375rem",
    },
    lineHeight: {
      default: 1.75,
      "@media (max-width: 540px)": 1.8,
    },
    maxWidth: {
      default: "370px",
      "@media (max-width: 850px)": "500px",
    },
    margin: "0",
  },
  heroActions: {
    display: "flex",
    alignItems: "center",
    gap: {
      default: "27px",
      "@media (max-width: 1150px)": "18px",
      "@media (max-width: 540px)": "16px",
    },
    margin: {
      default: "32px 0 40px",
      "@media (max-width: 540px)": "28px 0",
    },
    flexWrap: {
      default: null,
      "@media (max-width: 540px)": "wrap",
    },
  },
  textLink: {
    ":hover": {
      color: tokens.accent,
    },
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 1150px)": "0.75rem",
      "@media (max-width: 850px)": "0.875rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    display: "inline-flex",
    gap: "10px",
    alignItems: "center",
    transitionProperty: "color",
    transitionDuration: "0.2s",
  },
  heroFootnote: {
    display: "flex",
    gap: {
      default: "10px 16px",
      "@media (max-width: 1150px)": "12px",
      "@media (max-width: 540px)": "8px 12px",
    },
    fontWeight: 400,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 1150px)": "0.75rem",
      "@media (max-width: 850px)": "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: {
      default: "0.65px",
      "@media (max-width: 540px)": "0.8px",
    },
    color: tokens.textSubtle,
    flexWrap: "wrap",
  },
  footnoteItem: {
    "::before": {
      content: '"\u00b7"',
      paddingRight: {
        default: "16px",
        "@media (max-width: 1150px)": "12px",
        "@media (max-width: 540px)": "12px",
      },
      color: tokens.textSubtle,
    },
  },
  platformStrip: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    padding: {
      default: "27px 0",
      "@media (max-width: 540px)": "23px 0",
    },
    display: "flex",
    justifyContent: {
      default: "space-between",
      "@media (max-width: 540px)": "flex-start",
    },
    alignItems: "center",
    gap: {
      default: "25px",
      "@media (max-width: 850px)": "25px",
      "@media (max-width: 540px)": "18px 22px",
    },
    flexWrap: {
      default: null,
      "@media (max-width: 850px)": "wrap",
    },
    columnGap: {
      default: null,
      "@media (max-width: 540px)": "16px",
    },
    rowGap: {
      default: null,
      "@media (max-width: 540px)": "20px",
    },
  },
  stripIntro: {
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 850px)": "0.75rem",
    },
    lineHeight: 1.6,
    color: tokens.textMuted,
    width: {
      default: null,
      "@media (max-width: 850px)": "100%",
    },
  },
  br: {
    display: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
  },
  platformItem: {
    display: "flex",
    alignItems: "center",
    gap: {
      default: "12px",
      "@media (max-width: 540px)": "6px",
    },
    fontSize: {
      default: "1.1875rem",
      "@media (max-width: 1150px)": "1rem",
      "@media (max-width: 850px)": "1.0625rem",
      "@media (max-width: 540px)": "0.875rem",
    },
    fontWeight: 500,
    letterSpacing: {
      default: "-0.45px",
      "@media (max-width: 540px)": "-0.3px",
    },
    color: tokens.textSecondary,
  },
  platformLogo: {
    display: "block",
    width: { default: 32, "@media (max-width: 540px)": 24 },
    height: { default: 32, "@media (max-width: 540px)": 24 },
    objectFit: "contain",
    flexShrink: 0,
  },
  platformNote: {
    fontSize: "0.75rem",
    lineHeight: 1.6,
    color: tokens.textMuted,
    textAlign: "right",
    display: {
      default: null,
      "@media (max-width: 1150px)": "none",
    },
  },
  sectionIntro: {
    display: {
      default: "flex",
      "@media (max-width: 850px)": "block",
    },
    justifyContent: "space-between",
    gap: "30px",
    alignItems: "flex-end",
    marginBottom: "42px",
  },
  howHeading: {
    fontSize: {
      default: "2.375rem",
      "@media (max-width: 1150px)": "2rem",
      "@media (max-width: 540px)": "1.9375rem",
    },
    lineHeight: {
      default: 1.2,
      "@media (max-width: 540px)": 1.25,
    },
    letterSpacing: {
      default: "-1.7px",
      "@media (max-width: 540px)": "-1.3px",
    },
    fontWeight: 500,
    margin: "14px 0 0",
  },
  sectionHeadingMuted: {
    color: tokens.textSubtle,
    display: {
      default: null,
      "@media (max-width: 540px)": "block",
    },
  },
  sectionDescription: {
    fontSize: "1rem",
    lineHeight: 1.8,
    color: tokens.textMuted,
    margin: "0",
    marginTop: {
      default: null,
      "@media (max-width: 850px)": "18px",
    },
  },
  sectionInlineCode: {
    fontWeight: 400,
    fontSize: "0.75rem",
    lineHeight: "normal",
    fontFamily: '"IBM Plex Mono", monospace',
    color: tokens.textSecondary,
  },
  features: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, 1fr)",
      "@media (max-width: 540px)": "1fr",
    },
    gap: {
      default: "0",
      "@media (max-width: 850px)": "24px",
      "@media (max-width: 540px)": "25px",
    },
  },
  article: {
    padding: {
      default: "0 32px",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0 0 25px",
    },
    borderRightWidth: {
      default: "1px",
      "@media (max-width: 850px)": "0",
    },
    borderRightStyle: {
      default: "solid",
      "@media (max-width: 850px)": "none",
    },
    borderRightColor: {
      default: tokens.border,
      "@media (max-width: 850px)": "currentColor",
    },
    paddingLeft: "0",
    borderTopWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
    },
    borderTopStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
    borderTopColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
    },
    borderBottomWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "1px",
    },
    borderBottomStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "solid",
    },
    borderBottomColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": tokens.border,
    },
    borderLeftWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
    },
    borderLeftStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
    borderLeftColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
    },
  },
  featureTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "42px",
    marginBottom: {
      default: "22px",
      "@media (max-width: 540px)": "11px",
    },
  },
  featureNumber: {
    fontWeight: 400,
    fontSize: "0.75rem",
    lineHeight: "normal",
    fontFamily: '"IBM Plex Mono", monospace',
    color: tokens.textSubtle,
  },
  featureIcon: {
    height: "27px",
    width: "27px",
    fill: "none",
    stroke: tokens.accent,
    strokeWidth: "1.3",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  featureHeading: {
    fontSize: {
      default: "1.3125rem",
      "@media (max-width: 850px)": "1.1875rem",
      "@media (max-width: 540px)": "1.375rem",
    },
    letterSpacing: "-0.6px",
    fontWeight: 500,
    margin: "0 0 14px",
  },
  featureDescription: {
    fontSize: {
      default: "1rem",
      "@media (max-width: 850px)": "0.875rem",
      "@media (max-width: 540px)": "0.9375rem",
    },
    lineHeight: 1.8,
    color: tokens.textMuted,
    margin: "0 0 22px",
    minHeight: {
      default: "108px",
      "@media (max-width: 1150px)": "135px",
      "@media (max-width: 850px)": "176px",
      "@media (max-width: 540px)": "0",
    },
    marginBottom: {
      default: null,
      "@media (max-width: 540px)": "17px",
    },
  },
  featureLink: {
    ":hover": {
      color: tokens.accent,
    },
    display: "inline-flex",
    gap: "10px",
    fontSize: "0.875rem",
    transitionProperty: "color",
    transitionDuration: "0.2s",
  },
  article2: {
    padding: {
      default: "0 32px",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0 0 25px",
    },
    borderRightWidth: {
      default: "1px",
      "@media (max-width: 850px)": "0",
    },
    borderRightStyle: {
      default: "solid",
      "@media (max-width: 850px)": "none",
    },
    borderRightColor: {
      default: tokens.border,
      "@media (max-width: 850px)": "currentColor",
    },
    borderTopWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
    },
    borderTopStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
    borderTopColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
    },
    borderBottomWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "1px",
    },
    borderBottomStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "solid",
    },
    borderBottomColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": tokens.border,
    },
    borderLeftWidth: {
      default: null,
      "@media (max-width: 850px)": "0",
    },
    borderLeftStyle: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
    borderLeftColor: {
      default: null,
      "@media (max-width: 850px)": "currentColor",
    },
  },
  article3: {
    padding: {
      default: "0 32px",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0 0 25px",
    },
    borderRightWidth: {
      default: "0",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0",
    },
    borderRightStyle: {
      default: "none",
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "none",
    },
    borderRightColor: {
      default: "currentColor",
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": "currentColor",
    },
    borderTopWidth: {
      default: "0",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0",
    },
    borderTopStyle: {
      default: "none",
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "none",
    },
    borderTopColor: {
      default: "currentColor",
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": "currentColor",
    },
    borderBottomWidth: {
      default: "0",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "1px",
    },
    borderBottomStyle: {
      default: "none",
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "solid",
    },
    borderBottomColor: {
      default: "currentColor",
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": tokens.border,
    },
    borderLeftWidth: {
      default: "0",
      "@media (max-width: 850px)": "0",
      "@media (max-width: 540px)": "0",
    },
    borderLeftStyle: {
      default: "none",
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "none",
    },
    borderLeftColor: {
      default: "currentColor",
      "@media (max-width: 850px)": "currentColor",
      "@media (max-width: 540px)": "currentColor",
    },
    paddingRight: "0",
    paddingBottom: {
      default: null,
      "@media (max-width: 540px)": "0",
    },
  },
  startSection: {
    backgroundColor: tokens.surface,
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
    borderRadius: "9px",
    padding: {
      default: "42px",
      "@media (max-width: 1150px)": "32px",
      "@media (max-width: 540px)": "27px 21px",
    },
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1.3fr",
      "@media (max-width: 850px)": "1fr",
    },
    gap: {
      default: "45px",
      "@media (max-width: 1150px)": "28px",
      "@media (max-width: 850px)": "28px",
    },
    marginBottom: {
      default: "64px",
      "@media (max-width: 540px)": "35px",
    },
    position: "relative",
    overflow: "hidden",
    "::before": {
      content: '""',
      position: "absolute",
      left: "0",
      top: "0",
      bottom: "0",
      width: "3px",
      backgroundColor: tokens.accentFill,
    },
  },
  eyebrow3: {
    fontWeight: 500,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: {
      default: "1.1px",
      "@media (max-width: 540px)": "0.6px",
    },
    color: tokens.textMuted,
    display: "block",
  },
  startHeading: {
    fontSize: {
      default: "2.5rem",
      "@media (max-width: 540px)": "2.125rem",
    },
    lineHeight: 1.2,
    letterSpacing: "-1.8px",
    fontWeight: 500,
    margin: "14px 0 0",
    marginTop: "15px",
  },
  br2: {
    display: {
      default: null,
      "@media (max-width: 850px)": "none",
      "@media (max-width: 540px)": "block",
    },
  },
  startDescription: {
    color: tokens.textMuted,
    fontSize: {
      default: "1rem",
      "@media (max-width: 540px)": "0.875rem",
    },
    lineHeight: 1.8,
    margin: "18px 0",
  },
  textLink2: {
    ":hover": {
      color: tokens.accent,
    },
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 1150px)": "0.75rem",
    },
    display: "inline-flex",
    gap: "10px",
    alignItems: "center",
    transitionProperty: "color",
    transitionDuration: "0.2s",
    color: tokens.accent,
  },
  terminal: {
    minWidth: "0",
    alignSelf: "center",
    backgroundColor: tokens.bgSunken,
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
    borderRadius: "6px",
    overflow: "hidden",
  },
  terminalBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: {
      default: "15px 17px",
      "@media (max-width: 540px)": "12px",
    },
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    fontWeight: 400,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: "normal",
    fontFamily: '"IBM Plex Mono", monospace',
    color: tokens.textMuted,
    letterSpacing: "1px",
    flexWrap: {
      default: null,
      "@media (max-width: 540px)": "wrap",
    },
    gap: {
      default: null,
      "@media (max-width: 540px)": "8px",
    },
  },
  copyCommand: {
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
  terminalCode: {
    fontWeight: 400,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 850px)": "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: 2,
    fontFamily: '"IBM Plex Mono", monospace',
    padding: {
      default: "19px 17px",
      "@media (max-width: 540px)": "14px 12px",
    },
    margin: "0",
    overflow: "auto",
    color: tokens.textCode,
  },
  comment: {
    color: tokens.syntaxComment,
  },
  terminalNote: {
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    color: tokens.textSubtle,
    padding: {
      default: "12px 17px",
      "@media (max-width: 540px)": "12px",
    },
    lineHeight: 1.6,
  },
  terminalLink: {
    color: tokens.textSecondary,
    whiteSpace: "nowrap",
  },
});

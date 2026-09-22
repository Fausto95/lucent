import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";

export const styles = stylex.create({
  skipLink: {
    position: "fixed",
    top: "12px",
    left: "12px",
    backgroundColor: tokens.accentFill,
    color: tokens.onAccent,
    padding: "10px",
    zIndex: 10,
    transform: "translateY(-150%)",
    ":focus": {
      transform: "none",
    },
  },
  pageShell: {
    maxWidth: "1440px",
    margin: "auto",
    padding: {
      default: "0 64px",
      "@media (max-width: 1150px)": "0 36px",
      "@media (max-width: 850px)": "0 28px",
      "@media (max-width: 540px)": "0 22px",
    },
  },
  header: {
    height: {
      default: "108px",
      "@media (max-width: 850px)": "86px",
      "@media (max-width: 540px)": "80px",
    },
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  mainNav: {
    display: "flex",
    gap: {
      default: "36px",
      "@media (max-width: 850px)": "23px",
      "@media (max-width: 540px)": "12px",
    },
    alignItems: "center",
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 540px)": "0.75rem",
    },
  },
  overviewNavLink: {
    color: tokens.textSecondary,
    transitionProperty: "color",
    transitionDuration: "0.2s",
    ":hover": {
      color: tokens.accent,
    },
    fontSize: {
      default: null,
      "@media (max-width: 540px)": "0.875rem",
    },
    display: {
      default: null,
      "@media (max-width: 540px)": "none",
    },
  },
  languageNavLink: {
    color: tokens.textSecondary,
    transitionProperty: "color",
    transitionDuration: "0.2s",
    ":hover": {
      color: tokens.accent,
    },
    fontSize: {
      default: null,
      "@media (max-width: 540px)": "0.875rem",
    },
  },
  githubLink: {
    display: "flex",
    alignItems: "center",
    gap: {
      default: "8px",
      "@media (max-width: 540px)": "3px",
    },
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
    padding: {
      default: "10px 16px",
      "@media (max-width: 540px)": "8px 10px",
    },
    color: tokens.textSecondary,
    transitionProperty: "color",
    transitionDuration: "0.2s",
    fontSize: {
      default: null,
      "@media (max-width: 540px)": "0.875rem",
    },
    ":hover": {
      color: tokens.accent,
    },
  },
  externalLinkIcon: {
    width: {
      default: "17px",
      "@media (max-width: 540px)": "14px",
    },
    height: "17px",
    stroke: "currentColor",
    fill: "none",
    strokeWidth: "1.5",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: {
      default: "center",
      "@media (max-width: 540px)": "flex-start",
    },
    gap: "25px",
    padding: "28px 0 35px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    flexWrap: {
      default: null,
      "@media (max-width: 850px)": "wrap",
    },
  },
  footerTagline: {
    fontSize: {
      default: "0.8125rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    color: tokens.textSubtle,
    order: {
      default: null,
      "@media (max-width: 850px)": 3,
    },
    width: {
      default: null,
      "@media (max-width: 850px)": "100%",
    },
    margin: {
      default: null,
      "@media (max-width: 850px)": "0",
    },
  },
  footerLinks: {
    display: "flex",
    gap: {
      default: "25px",
      "@media (max-width: 540px)": "10px",
    },
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    flexWrap: {
      default: null,
      "@media (max-width: 540px)": "wrap",
    },
  },
  footerLink: {
    ":hover": {
      color: tokens.accent,
    },
  },
  footerLicense: {
    color: tokens.textSubtle,
  },
  activeNav: {
    color: tokens.accent,
  },
});

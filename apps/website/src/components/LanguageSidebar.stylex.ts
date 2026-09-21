import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  referenceSidebar: {
    position: {
      default: "sticky",
      "@media (max-width: 850px)": "static",
    },
    top: "32px",
    maxHeight: { default: "calc(100dvh - 64px)", "@media (max-width: 850px)": "none" },
    overflowY: { default: "auto", "@media (max-width: 850px)": "visible" },
    alignSelf: "start",
    borderBottomWidth: {
      default: null,
      "@media (max-width: 850px)": "1px",
    },
    borderBottomStyle: {
      default: null,
      "@media (max-width: 850px)": "solid",
    },
    borderBottomColor: {
      default: null,
      "@media (max-width: 850px)": "#30362b",
    },
    paddingBottom: {
      default: null,
      "@media (max-width: 850px)": "24px",
    },
    marginBottom: {
      default: null,
      "@media (max-width: 850px)": "36px",
    },
  },
  referenceNav: {
    display: {
      default: null,
      "@media (max-width: 850px)": "grid",
    },
    gridTemplateColumns: {
      default: null,
      "@media (max-width: 850px)": "repeat(2, minmax(0, 1fr))",
    },
  },
  eyebrow4: {
    fontWeight: 500,
    fontSize: {
      default: "0.75rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
    letterSpacing: {
      default: "1px",
      "@media (max-width: 540px)": "1px",
    },
    color: "#b8c0ae",
    display: "block",
    margin: "0 0 22px",
    gridColumn: {
      default: null,
      "@media (max-width: 850px)": "1 / -1",
    },
    marginBottom: {
      default: null,
      "@media (max-width: 850px)": "14px",
    },
  },
  referenceNavLink: {
    display: "flex",
    gap: {
      default: "14px",
      "@media (max-width: 1150px)": "10px",
      "@media (max-width: 540px)": "8px",
    },
    alignItems: "center",
    padding: {
      default: "12px 14px",
      "@media (max-width: 540px)": "10px 7px",
    },
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "#30362b",
    color: "#a0a79a",
    fontSize: {
      default: "0.875rem",
      "@media (max-width: 540px)": "0.8125rem",
    },
    transitionProperty: "color, background-color",
    transitionDuration: "0.2s, 0.2s",
    ":hover": {
      color: "#c4f778",
      backgroundColor: "#1c2516",
      borderColor: "#c4f778",
    },
    paddingInline: {
      default: null,
      "@media (max-width: 1150px)": "10px",
    },
  },
  referenceNavNumber: {
    fontWeight: 400,
    fontSize: "0.75rem",
    lineHeight: "normal",
    fontFamily: '"IBM Plex Mono", monospace',
    color: "#78846e",
  },
  referenceBack: {
    display: {
      default: "inline-block",
      "@media (max-width: 850px)": "none",
    },
    margin: "35px 0 24px 14px",
    fontSize: "0.875rem",
    color: "#c1cab8",
    ":hover": {
      color: "#c4f778",
    },
  },
  referenceVersion: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "#30362b",
    padding: "20px 14px",
    color: "#a0a79a",
    fontSize: "0.75rem",
    display: {
      default: null,
      "@media (max-width: 850px)": "none",
    },
  },
  referenceVersionNumber: {
    fontFamily: '"IBM Plex Mono", monospace',
    color: "#c4f778",
    marginRight: "12px",
  },
  activeSection: {
    color: "#c4f778",
    backgroundColor: "#1c2516",
    borderColor: "#c4f778",
  },
});

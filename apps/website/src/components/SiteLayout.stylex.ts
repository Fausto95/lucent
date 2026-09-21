import * as stylex from "@stylexjs/stylex";

export const styles = stylex.create({
  skipLink: {
    position: "fixed",
    top: "12px",
    left: "12px",
    backgroundColor: "#c4f778",
    color: "#111411",
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
    borderBottomColor: "#30362b",
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    fontWeight: 650,
    fontSize: {
      default: "2rem",
      "@media (max-width: 540px)": "1.75rem",
    },
    letterSpacing: "-1.8px",
  },
  brandMark: {
    display: "flex",
    gap: "4px",
    alignItems: "flex-end",
    height: "29px",
    marginRight: {
      default: "12px",
      "@media (max-width: 540px)": "7px",
    },
    transform: {
      default: null,
      "@media (max-width: 540px)": "scale(0.85)",
    },
  },
  brandBarTall: {
    backgroundColor: "#c4f778",
    display: "block",
    width: "6px",
    height: "29px",
    transform: "skewY(-15deg)",
  },
  brandBarMedium: {
    backgroundColor: "#c4f778",
    display: "block",
    width: "6px",
    height: "21px",
    transform: "skewY(-15deg)",
  },
  brandBarShort: {
    backgroundColor: "#c4f778",
    display: "block",
    width: "6px",
    height: "13px",
    transform: "skewY(-15deg)",
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
    color: "#c6cbc1",
    transitionProperty: "color",
    transitionDuration: "0.2s",
    ":hover": {
      color: "#c4f778",
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
    color: "#c6cbc1",
    transitionProperty: "color",
    transitionDuration: "0.2s",
    ":hover": {
      color: "#c4f778",
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
    borderTopColor: "#42493c",
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: "#42493c",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "#42493c",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "#42493c",
    borderRadius: "6px",
    padding: {
      default: "10px 16px",
      "@media (max-width: 540px)": "8px 10px",
    },
    color: "#c6cbc1",
    transitionProperty: "color",
    transitionDuration: "0.2s",
    fontSize: {
      default: null,
      "@media (max-width: 540px)": "0.875rem",
    },
    ":hover": {
      color: "#c4f778",
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
    borderTopColor: "#30362b",
    flexWrap: {
      default: null,
      "@media (max-width: 850px)": "wrap",
    },
  },
  footerBrand: {
    ":hover": {
      color: "#c4f778",
    },
    display: "inline-flex",
    alignItems: "center",
    fontWeight: 650,
    fontSize: {
      default: "1.5625rem",
      "@media (max-width: 540px)": "1.4375rem",
    },
    letterSpacing: "-1.8px",
  },
  footerBrandMark: {
    display: "flex",
    gap: "4px",
    alignItems: "flex-end",
    height: "29px",
    marginRight: {
      default: "4px",
      "@media (max-width: 540px)": "7px",
    },
    transform: {
      default: "scale(0.75)",
      "@media (max-width: 540px)": "scale(0.85)",
    },
    transformOrigin: "left center",
  },
  footerTagline: {
    fontSize: {
      default: "0.8125rem",
      "@media (max-width: 540px)": "0.75rem",
    },
    color: "#939e87",
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
      color: "#c4f778",
    },
  },
  footerLicense: {
    color: "#8d9783",
  },
  activeNav: {
    color: "#c4f778",
  },
});

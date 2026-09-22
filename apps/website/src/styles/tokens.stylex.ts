import * as stylex from "@stylexjs/stylex";

/*
 * The site's colour roles. Every StyleX file and the SVG diagrams read
 * these; nothing else hard-codes a colour. Defaults are dark and follow
 * the OS preference; `darkTheme` / `lightTheme` force one regardless of
 * the OS when the visitor picks explicitly (see ThemeProvider).
 *
 * Written out as literals because StyleX evaluates this file at build
 * time and only understands plain object syntax.
 */

export const tokens = stylex.defineVars({
  scheme: { default: "dark", "@media (prefers-color-scheme: light)": "light" },
  bg: { default: "#111411", "@media (prefers-color-scheme: light)": "#f7f8f3" },
  bgRaised: { default: "#181e14", "@media (prefers-color-scheme: light)": "#ffffff" },
  bgSunken: { default: "#131810", "@media (prefers-color-scheme: light)": "#f1f4ea" },
  surface: { default: "#1b2416", "@media (prefers-color-scheme: light)": "#eef3e3" },
  surfaceStrong: { default: "#22301a", "@media (prefers-color-scheme: light)": "#dfeccb" },
  border: { default: "#30362b", "@media (prefers-color-scheme: light)": "#dde2d4" },
  borderStrong: { default: "#37412f", "@media (prefers-color-scheme: light)": "#cbd3c0" },
  text: { default: "#f0f2eb", "@media (prefers-color-scheme: light)": "#151a12" },
  textSecondary: { default: "#d0d8c7", "@media (prefers-color-scheme: light)": "#2f3829" },
  textMuted: { default: "#aeb7a4", "@media (prefers-color-scheme: light)": "#4f5a47" },
  textSubtle: { default: "#8d9783", "@media (prefers-color-scheme: light)": "#6b7661" },
  textCode: { default: "#d5e4c7", "@media (prefers-color-scheme: light)": "#1f2a19" },
  accent: { default: "#c4f778", "@media (prefers-color-scheme: light)": "#3c7a12" },
  accentHover: { default: "#d5ff9c", "@media (prefers-color-scheme: light)": "#2f620d" },
  accentFill: { default: "#c4f778", "@media (prefers-color-scheme: light)": "#c4f778" },
  accentFillHover: { default: "#d5ff9c", "@media (prefers-color-scheme: light)": "#b3ec60" },
  onAccent: { default: "#17210e", "@media (prefers-color-scheme: light)": "#17210e" },
  accentBorder: { default: "#5f7a3d", "@media (prefers-color-scheme: light)": "#9ccb6a" },
  syntaxKeyword: { default: "#c7a4e1", "@media (prefers-color-scheme: light)": "#7b3fb5" },
  syntaxType: { default: "#d7d393", "@media (prefers-color-scheme: light)": "#8a6a00" },
  syntaxComment: { default: "#7c8873", "@media (prefers-color-scheme: light)": "#7b8472" },
  swift: { default: "#d9a27b", "@media (prefers-color-scheme: light)": "#c2571a" },
  kotlin: { default: "#b8a7e8", "@media (prefers-color-scheme: light)": "#6e3fc2" },
  warn: { default: "#e6b45a", "@media (prefers-color-scheme: light)": "#a86f0e" },
  warnSurface: { default: "#251f14", "@media (prefers-color-scheme: light)": "#fdf3dd" },
  shadow: { default: "#00000018", "@media (prefers-color-scheme: light)": "#00000012" },
  shadowStrong: { default: "#00000070", "@media (prefers-color-scheme: light)": "#00000030" },
});

export const darkTheme = stylex.createTheme(tokens, {
  scheme: "dark",
  bg: "#111411",
  bgRaised: "#181e14",
  bgSunken: "#131810",
  surface: "#1b2416",
  surfaceStrong: "#22301a",
  border: "#30362b",
  borderStrong: "#37412f",
  text: "#f0f2eb",
  textSecondary: "#d0d8c7",
  textMuted: "#aeb7a4",
  textSubtle: "#8d9783",
  textCode: "#d5e4c7",
  accent: "#c4f778",
  accentHover: "#d5ff9c",
  accentFill: "#c4f778",
  accentFillHover: "#d5ff9c",
  onAccent: "#17210e",
  accentBorder: "#5f7a3d",
  syntaxKeyword: "#c7a4e1",
  syntaxType: "#d7d393",
  syntaxComment: "#7c8873",
  swift: "#d9a27b",
  kotlin: "#b8a7e8",
  warn: "#e6b45a",
  warnSurface: "#251f14",
  shadow: "#00000018",
  shadowStrong: "#00000070",
});

export const lightTheme = stylex.createTheme(tokens, {
  scheme: "light",
  bg: "#f7f8f3",
  bgRaised: "#ffffff",
  bgSunken: "#f1f4ea",
  surface: "#eef3e3",
  surfaceStrong: "#dfeccb",
  border: "#dde2d4",
  borderStrong: "#cbd3c0",
  text: "#151a12",
  textSecondary: "#2f3829",
  textMuted: "#4f5a47",
  textSubtle: "#6b7661",
  textCode: "#1f2a19",
  accent: "#3c7a12",
  accentHover: "#2f620d",
  accentFill: "#c4f778",
  accentFillHover: "#b3ec60",
  onAccent: "#17210e",
  accentBorder: "#9ccb6a",
  syntaxKeyword: "#7b3fb5",
  syntaxType: "#8a6a00",
  syntaxComment: "#7b8472",
  swift: "#c2571a",
  kotlin: "#6e3fc2",
  warn: "#a86f0e",
  warnSurface: "#fdf3dd",
  shadow: "#00000012",
  shadowStrong: "#00000030",
});

/** Plain values for the one place CSS variables cannot reach: the theme-color meta tag. */
export const themeColors = { dark: "#111411", light: "#f7f8f3" } as const;

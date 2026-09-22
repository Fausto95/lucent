import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import { darkTheme, lightTheme, themeColors } from "../styles/tokens.stylex";
import { styles } from "./ThemeProvider.stylex";
import {
  LIGHT_QUERY,
  STORAGE_KEY,
  ThemeContext,
  readStoredPreference,
  systemTheme,
  type Theme,
  type ThemePreference,
} from "./themeContext";

const explicitThemes = { dark: darkTheme, light: lightTheme };

/**
 * Owns the theme preference and is the single writer of everything derived
 * from it: the StyleX theme class on <html>, `data-theme` for the few plain
 * CSS rules, localStorage, and the theme-color meta tag.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme: Theme = preference === "system" ? system : preference;

  useEffect(() => {
    const query = window.matchMedia(LIGHT_QUERY);
    const update = () => setSystem(query.matches ? "light" : "dark");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const explicit = preference === "system" ? null : explicitThemes[preference];
    root.className = stylex.props(styles.document, explicit ?? undefined).className ?? "";
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[theme]);
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  }, [preference, theme]);

  return <ThemeContext value={{ theme, preference, setPreference }}>{children}</ThemeContext>;
}

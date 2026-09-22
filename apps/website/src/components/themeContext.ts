import { createContext, useContext } from "react";

export type Theme = "dark" | "light";
/** What the visitor chose. `system` follows the OS and is the default. */
export type ThemePreference = Theme | "system";

export interface ThemeState {
  /** The theme in effect after resolving `system`. */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const STORAGE_KEY = "lucent-theme";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

export const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme must be used inside ThemeProvider");
  return state;
}

export function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

export function systemTheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

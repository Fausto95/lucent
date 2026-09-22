import * as stylex from "@stylexjs/stylex";
import { styles } from "./ThemeToggle.stylex";
import { useTheme } from "./themeContext";

/** Sun/moon button. Picks the opposite of the theme in effect and remembers it. */
export function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      {...stylex.props(styles.button)}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.icon)}>
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4"></path>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.icon)}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path>
        </svg>
      )}
    </button>
  );
}

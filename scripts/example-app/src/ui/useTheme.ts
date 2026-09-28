import { useColorScheme } from "react-native";
import { dark, light, type Theme } from "./theme";

/** The theme for the system's light or dark appearance. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

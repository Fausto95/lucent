import type { ReactNode } from "react";
import { View } from "react-native";
import { space } from "./theme";

/** Children one above the other, `gap` apart. */
export function Stack({ gap = space.sm, children }: { gap?: number; children: ReactNode }) {
  return <View style={{ gap }}>{children}</View>;
}

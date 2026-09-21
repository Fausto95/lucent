import { T, type NativeType } from "./types/native-type.ts";
export interface PrimitiveDefinition {
  props: Record<string, NativeType>;
  children: "views" | "text" | "none";
  required?: string[];
}
const layout = { padding: T.float64, spacing: T.float64 };
export const UI_PRIMITIVES: Readonly<Record<string, PrimitiveDefinition>> = {
  VStack: { props: layout, children: "views" },
  HStack: { props: layout, children: "views" },
  Text: { props: { size: T.float64, color: T.string }, children: "text" },
  Spacer: { props: { size: T.float64 }, children: "none" },
  Button: { props: { title: T.string, onPress: T.event(T.void) }, children: "none", required: ["title"] },
};

import { T, type NativeType } from "./types/native-type.ts";
export interface PrimitiveDefinition {
  props: Record<string, NativeType>;
  children: "views" | "text" | "none";
  required?: string[];
}
const layout = { padding: T.float64, spacing: T.float64 };
export const UI_PRIMITIVES: Readonly<Record<string, PrimitiveDefinition>> = {
  TextField: {
    props: { value: T.string, placeholder: T.string, onChange: T.event(T.string) },
    required: ["value", "onChange"],
    children: "none",
  },
  Toggle: {
    props: { value: T.bool, title: T.string, onChange: T.event(T.bool) },
    required: ["value", "title", "onChange"],
    children: "none",
  },
  Slider: {
    props: { value: T.float64, min: T.float64, max: T.float64, onChange: T.event(T.float64) },
    required: ["value", "onChange"],
    children: "none",
  },
  ScrollView: { props: {}, children: "views" },
  ZStack: { props: {}, children: "views" },
  Padding: { props: { value: T.float64 }, required: ["value"], children: "views" },
  Background: { props: { color: T.string }, required: ["color"], children: "views" },
  CornerRadius: { props: { value: T.float64 }, required: ["value"], children: "views" },
  Accessibility: { props: { label: T.string }, required: ["label"], children: "views" },
  VStack: { props: layout, children: "views" },
  HStack: { props: layout, children: "views" },
  Text: { props: { size: T.float64, color: T.string }, children: "text" },
  Spacer: { props: { size: T.float64 }, children: "none" },
  Button: { props: { title: T.string, onPress: T.event(T.void) }, children: "none", required: ["title"] },
};

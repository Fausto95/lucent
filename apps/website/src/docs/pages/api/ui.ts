import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/ui",
  title: "@lucent-lang/core/ui",
  description: "Primitives and wrappers for `.lucent.tsx` native views, plus the `NativeView` and `NativeProps` types.",
  blocks: [
    {
      kind: "code",
      filename: "declaration",
      code: 'import type { ReactElement, ReactNode } from "react";\nimport type { ViewProps } from "react-native";\nimport type { Event } from "@lucent-lang/core/events";\n\n/** Compiled to SwiftUI/Compose by Lucent. These declarations have no JS runtime. */\nexport type NativeView = ReactElement;\n/** React Native host layout props are applied by React, not read by the native render function. */\nexport type NativeProps<P> = P & ViewProps;\n\ntype LayoutProps = { padding?: number; spacing?: number; children?: ReactNode };\nexport declare function VStack(props: LayoutProps): NativeView;\nexport declare function HStack(props: LayoutProps): NativeView;\nexport declare function ZStack(props: { children?: ReactNode }): NativeView;\nexport declare function ScrollView(props: { children?: ReactNode }): NativeView;\nexport declare function Text(props: { size?: number; color?: string; children?: ReactNode }): NativeView;\nexport declare function Spacer(props: { size?: number }): NativeView;\nexport declare function Button(props: { title: string; onPress?: Event<void> }): NativeView;\nexport declare function TextField(props: { value: string; placeholder?: string; onChange: Event<string> }): NativeView;\nexport declare function Toggle(props: { value: boolean; title: string; onChange: Event<boolean> }): NativeView;\nexport declare function Slider(props: { value: number; min?: number; max?: number; onChange: Event<number> }): NativeView;\nexport declare function Padding(props: { value: number; children?: ReactNode }): NativeView;\nexport declare function Background(props: { color: string; children?: ReactNode }): NativeView;\nexport declare function CornerRadius(props: { value: number; children?: ReactNode }): NativeView;\nexport declare function Accessibility(props: { label: string; children?: ReactNode }): NativeView;',
    },
    { kind: "h2", text: "Layout" },
    {
      kind: "table",
      head: ["Primitive", "iOS", "Android", "Notes"],
      rows: [
        ["`VStack`", "`VStack`", "`Column`", "`padding` and `spacing` in logical units"],
        ["`HStack`", "`HStack`", "`Row`", "same props"],
        ["`ZStack`", "`ZStack`", "`Box`", "children overlap"],
        ["`ScrollView`", "`ScrollView`", "`Column` + `verticalScroll`", "vertical"],
        ["`Spacer`", "`Spacer`", "`Spacer`", "`size` defaults to 8"],
      ],
    },
    { kind: "h2", text: "Content and controls" },
    {
      kind: "table",
      head: ["Primitive", "Required", "Optional", "Event payload"],
      rows: [
        ["`Text`", "children (string, number, boolean)", "`size`, `color` as `#RRGGBB`", ""],
        ["`Button`", "`title`", "`onPress`", "`void`"],
        ["`TextField`", "`value`, `onChange`", "`placeholder`", "`string`"],
        ["`Toggle`", "`value`, `title`, `onChange`", "", "`boolean`"],
        ["`Slider`", "`value`, `onChange`", "`min`, `max` (default 0–1)", "`number`"],
      ],
    },
    { kind: "h2", text: "Wrappers" },
    {
      kind: "p",
      text: "Each wrapper applies one modifier to its children and groups multiple children vertically with zero spacing. Nest wrappers to control order.",
    },
    {
      kind: "table",
      head: ["Wrapper", "Required prop", "iOS", "Android"],
      rows: [
        ["`Padding`", "`value`", "`.padding()`", "`Modifier.padding()`"],
        ["`Background`", "`color`", "`.background()`", "`Modifier.background()`"],
        ["`CornerRadius`", "`value`", "`.cornerRadius()`", "`Modifier.clip(RoundedCornerShape())`"],
        ["`Accessibility`", "`label`", "`.accessibilityLabel()`", "`Modifier.semantics { contentDescription }`"],
      ],
    },
    { kind: "h2", text: "Types" },
    {
      kind: "list",
      items: [
        "`NativeView` is the return type of every view function. It is `ReactElement` for the editor only.",
        "`NativeProps<P>` is what the app sees: your props plus React Native `ViewProps` such as `style`. Inside the render function only `P` is available.",
      ],
    },
    {
      kind: "p",
      text: "Rules for render functions, prop types and hosting are in [native views](/docs/language/native-views/). Custom views from packages are described in the [library manifest](/docs/api/library-manifest/#views).",
    },
  ],
};

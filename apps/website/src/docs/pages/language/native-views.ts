import { ViewsDiagram } from "../../../components/diagrams/ViewsDiagram";
import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/native-views",
  title: "Native views",
  description:
    "Write a component once in `.lucent.tsx`. Lucent generates SwiftUI for iOS and Jetpack Compose for Android, hosted by an Expo view or a Nitro Fabric view.",
  blocks: [
    {
      kind: "code",
      filename: "card.lucent.tsx",
      code: 'import { VStack, Text, Button, type NativeProps, type NativeView } from "@lucent-lang/ui";\nimport type { Event } from "@lucent-lang/events";\n\ntype Props = { title: string; onPress: Event<void> };\n\nexport function Card(props: NativeProps<Props>): NativeView {\n  return (\n    <VStack padding={16} spacing={12}>\n      <Text size={20}>{props.title}</Text>\n      <Button title="Continue" onPress={props.onPress} />\n    </VStack>\n  );\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { useState } from "react";\nimport { Card } from "./src/card.lucent";\n\nexport function Screen() {\n  const [count, setCount] = useState(0);\n  return <Card style={{ height: 140 }} title={`Taps: ${count}`} onPress={() => setCount((n) => n + 1)} />;\n}',
    },
    { kind: "diagram", component: ViewsDiagram },
    { kind: "h2", text: "The model" },
    {
      kind: "list",
      items: [
        "An exported function returning `NativeView` that takes one props record (or nothing) is a native view.",
        "`NativeProps<P>` adds React Native's `ViewProps` for the app side. Inside the render function only `P` exists; React applies `style` and layout to the host view.",
        "Rendering is synchronous and pure. Effects, mutation, async calls and loops in a render function are rejected. Keep state in React and pass new props.",
        "Props are scalars, nullable scalars, and `Event<void | string | boolean | number>` callbacks.",
        "Compose other `.lucent.tsx` components by importing them; pass typed props.",
        "Not in the subset: hooks, arbitrary React components, dynamic lists, JSX spreads and fragments, custom `children`.",
      ],
    },
    { kind: "h2", text: "Controls" },
    {
      kind: "table",
      head: ["Primitive", "Props", "Children"],
      rows: [
        ["`VStack`, `HStack`", "`padding?`, `spacing?`", "views"],
        ["`ZStack`, `ScrollView`", "none", "views"],
        ["`Text`", "`size?`, `color?` (`#RRGGBB`)", "strings, numbers, booleans"],
        ["`Spacer`", "`size?` (default 8)", "none"],
        ["`Button`", "`title`, `onPress?: Event<void>`", "none"],
        ["`TextField`", "`value`, `onChange: Event<string>`, `placeholder?`", "none"],
        ["`Toggle`", "`value`, `title`, `onChange: Event<boolean>`", "none"],
        ["`Slider`", "`value`, `onChange: Event<number>`, `min?`, `max?` (default 0–1)", "none"],
      ],
    },
    {
      kind: "p",
      text: "Inputs are controlled: the app owns the value and receives changes. `VStack` and `HStack` emit SwiftUI `VStack` / `HStack` and Compose `Column` / `Row`.",
    },
    { kind: "h2", text: "Wrappers" },
    {
      kind: "p",
      text: "Wrappers apply one modifier to their children. Nest them to fix the order. They group multiple children vertically with zero spacing; they are not a full SwiftUI or Compose modifier API.",
    },
    {
      kind: "table",
      head: ["Wrapper", "Props"],
      rows: [
        ["`Padding`", "`value`"],
        ["`Background`", "`color`"],
        ["`CornerRadius`", "`value`"],
        ["`Accessibility`", "`label`"],
      ],
    },
    {
      kind: "code",
      filename: "tile.lucent.tsx",
      code: 'import { Background, CornerRadius, Padding, Text, type NativeProps, type NativeView } from "@lucent-lang/ui";\n\ntype Props = { label: string };\n\nexport function Tile(props: NativeProps<Props>): NativeView {\n  return (\n    <Background color="#1b2416">\n      <CornerRadius value={12}>\n        <Padding value={16}>\n          <Text color="#c4f778">{props.label}</Text>\n        </Padding>\n      </CornerRadius>\n    </Background>\n  );\n}',
    },
    { kind: "h2", text: "Package views" },
    {
      kind: "p",
      text: "A library can ship its own SwiftUI and Compose adapters and expose them as views without changing the compiler. Adapters may own native state (`@State`, `remember`) and report changes through event props. The example apps include a package-defined counter. See the [library manifest](/docs/api/library-manifest/#views) and the [example](/docs/examples/#a-native-package-view).",
    },
    { kind: "h2", text: "Hosting" },
    {
      kind: "list",
      items: [
        "Expo: the view is an Expo view module; Android compositions use detach-and-pool disposal so an unmounted host does not wait for the activity.",
        "Nitro: the view is a Fabric component and requires the React Native new architecture.",
        "View controller containment, composition disposal, prop updates and callback bridging are generated.",
        "Changing a `.lucent.tsx` file changes native code: rebuild the app.",
      ],
    },
  ],
};

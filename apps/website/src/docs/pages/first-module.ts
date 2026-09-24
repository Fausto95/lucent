import type { Block } from "../types";

export const blocks: Block[] = [
  {
    kind: "steps",
    steps: [
      {
        title: "Write the module",
        blocks: [
          {
            kind: "code",
            filename: "greet.lucent.ts",
            code: `export function greet(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? \`Hello, \${trimmed}!\` : "Hello, stranger!";
}`,
          },
          { kind: "p", text: "Save it as `src/greet.lucent.ts`. Any `*.lucent.ts` file is a module, and its exports are what JavaScript can call." },
        ],
      },
      {
        title: "Call it from a screen",
        blocks: [
          {
            kind: "code",
            filename: "App.tsx",
            code: `import { Text } from "react-native";
import { greet } from "./src/greet.lucent";

export default function App() {
  return <Text>{greet("  Ada ")}</Text>;
}`,
          },
          { kind: "p", text: "The import is typed from the source, so your editor checks the call." },
        ],
      },
      {
        title: "Run the app",
        blocks: [
          {
            kind: "panels",
            panels: [
              {
                label: "Expo",
                blocks: [
                  { kind: "code", filename: "terminal", code: "npx expo run:ios" },
                  { kind: "p", text: "The config plugin builds your modules during prebuild. Xcode then compiles the C++ into the app." },
                ],
              },
              {
                label: "Bare React Native",
                blocks: [
                  {
                    kind: "code",
                    filename: "terminal",
                    code: `npx lucent build
cd ios && pod install && cd ..
npx react-native run-ios`,
                  },
                  { kind: "p", text: "On Android, skip the first two lines: the Gradle task runs `lucent build` itself." },
                ],
              },
            ],
          },
          { kind: "p", text: "The screen shows `Hello, Ada!`, computed in C++." },
        ],
      },
      {
        title: "Change it",
        blocks: [
          {
            kind: "p",
            text: "Change `Hello` to `Hi` and save. While Metro runs, `lucent dev` rebuilds the native package and prints one line in Metro's output:",
          },
          { kind: "code", filename: "terminal", copy: false, code: "[14:02:11] ✓ 2 modules  36 ms · rebuild the app" },
          {
            kind: "p",
            text: "The C++ is part of the app binary, so reloading JavaScript doesn't replace it. Run the app again to see `Hi, Ada!`.",
          },
        ],
      },
      {
        title: "Read an error",
        blocks: [
          { kind: "p", text: "Change the parameter to `name: any` and save:" },
          {
            kind: "code",
            filename: "terminal",
            copy: false,
            code: `[14:03:40] ✗ 1 error
  src/greet.lucent.ts:1:23  LUCENT2001  \`any\` has no native representation; give this value a concrete type
    fix: use a concrete type, a union, or a generic parameter`,
          },
          {
            kind: "p",
            text: "Each error has a code, a place and a fix. `npx lucent explain LUCENT2001` shows why the rule exists, with a wrong and a right example. Put `string` back.",
          },
        ],
      },
    ],
  },
  { kind: "h2", text: "What happened" },
  {
    kind: "list",
    ordered: true,
    items: [
      "The TypeScript checker checked `greet.lucent.ts` against Lucent's rules.",
      "Lucent compiled it to C++ and wrote the native package to `.lucent/native`.",
      "Xcode or Gradle compiled the native package into your app.",
      "Metro replaced the `greet.lucent` import with a proxy.",
      "Calling `greet` went through JSI to the C++ and back.",
    ],
  },
  { kind: "p", text: "[How Lucent works](/docs/how-it-works/) follows each step." },
];

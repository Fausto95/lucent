import type { Block, DocFrontmatter } from "../../types";
import { requirements } from "../../../generated/compatibility";

export const frontmatter: DocFrontmatter = {
  title: "Compatibility",
  description:
    "The React Native, Expo, Node, JDK, Android, iOS and TypeScript versions Lucent supports, and the machines it builds on.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "note",
    text: `No stable release meets these yet. In October 2026, \`react-native@latest\` is 0.87 and \`expo@latest\` is SDK 57. Use the React Native ${requirements.reactNative} release candidate (\`react-native@next\`) or the Expo SDK ${requirements.expoSdk} preview (\`expo@next\`), as the example apps do.`,
  },
  {
    kind: "table",
    head: ["", "Supported"],
    rows: [
      ["React Native", `${requirements.reactNative} or later, New Architecture`],
      ["Expo", `SDK ${requirements.expoSdk} or later, in a development build`],
      ["Node", `${requirements.node} or later`],
      ["JDK, for Android builds", `${requirements.jdk.min} to ${requirements.jdk.max}`],
      [
        "Android",
        `API ${requirements.minAndroidApi} and later; newer APIs need an \`available\` check`,
      ],
      [
        "iOS",
        `${requirements.minIos} and later; APIs newer than the app's deployment target need an \`available\` check`,
      ],
      [
        "TypeScript",
        `${requirements.typescript.replace(/^[~^]/, "")}, which the package brings; modules are checked against ${requirements.lib.map((l) => `\`${l.replace(/^lib\.|\.d\.ts$/g, "")}\``).join(" and ")}`,
      ],
      ["Xcode, Android SDK and NDK", "the versions your React Native version needs"],
    ],
  },
  { kind: "h2", text: "Operating systems" },
  {
    kind: "table",
    head: ["Machine", "What works"],
    rows: [
      ["macOS", "Everything: iOS and Android builds, and checks of both platforms' code."],
      [
        "Linux",
        "Android builds and checks. Without Xcode, iOS code is untyped: `lucent build` and `lucent check` skip iOS with a warning.",
      ],
      ["Windows", "Untested. WSL is a Linux machine."],
    ],
  },
  {
    kind: "p",
    text: "`lucent doctor` checks these on your machine, and this table is generated from the same numbers.",
  },
  {
    kind: "p",
    text: "Tested on the iOS simulator (Xcode 27) and the Android emulator, in the example apps, bare and Expo. Not yet on physical devices ([roadmap](/docs/releases/roadmap/)).",
  },
];

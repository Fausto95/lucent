import type { Block, DocFrontmatter } from "../../types";
import { requirements } from "../../../generated/compatibility";

export const frontmatter: DocFrontmatter = {
  title: "Compatibility",
  description:
    "The React Native, Expo, Node, JDK, Android, iOS and TypeScript versions Lucent supports.",
  kind: "reference",
};

export const blocks: Block[] = [
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
      ["iOS", `${requirements.minIos} and later; newer APIs need an \`available\` check`],
      [
        "TypeScript",
        `${requirements.typescript.replace(/^[~^]/, "")}, which the package brings; modules are checked against ${requirements.lib.map((l) => `\`${l.replace(/^lib\.|\.d\.ts$/g, "")}\``).join(" and ")}`,
      ],
      ["Xcode, Android SDK and NDK", "the versions your React Native version needs"],
    ],
  },
  {
    kind: "p",
    text: "`lucent doctor` checks these on your machine, and this table is generated from the same numbers.",
  },
  {
    kind: "p",
    text: "Tested on the iOS simulator (Xcode 27) and the Android emulator, in the example apps, bare and Expo. Not yet on physical devices ([roadmap](/docs/roadmap/)).",
  },
];

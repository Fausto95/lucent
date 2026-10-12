import type { Block, DocFrontmatter } from "../../types";
import { requirements } from "../../../generated/compatibility";

const { reactNative, expoSdk } = requirements;

export const frontmatter: DocFrontmatter = {
  title: "Compatibility",
  description:
    "The React Native, Expo, Node, JDK, Android, iOS and TypeScript versions Lucent supports, and the machines it builds on.",
  kind: "reference",
};

export const blocks: Block[] = [
  {
    kind: "p",
    text: `Lucent supports the current and the previous stable releases of React Native and Expo. A prerelease lane beside them is where the example apps run. When a stable release ships, it joins, the oldest leaves, and the lane moves to the next release candidate.`,
  },
  {
    kind: "table",
    head: ["", "Supported"],
    rows: [
      [
        "React Native",
        `${reactNative.window[0]} to ${reactNative.window.at(-1)}, New Architecture (${reactNative.window[0]} is Expo SDK ${expoSdk.window[0]}'s); ${reactNative.prerelease}'s release candidates on the prerelease lane`,
      ],
      [
        "Expo",
        `SDK ${expoSdk.window.join(" and ")}, in a development build; the SDK ${expoSdk.prerelease} preview on the prerelease lane`,
      ],
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
      [
        "macOS",
        "Everything. iOS needs macOS: Xcode types iOS code and builds it, and nothing else does.",
      ],
      [
        "Linux",
        "Android builds and checks. iOS code is untyped and isn't compiled: `lucent build` and `lucent check` skip iOS with a warning. Lucent can't import iOS types from another machine, so type errors in iOS code show only on a Mac.",
      ],
      ["Windows", "Unsupported and untested. Use WSL, which is a Linux machine: Android only."],
    ],
  },
  {
    kind: "p",
    text: "`lucent doctor` checks these on your machine and names the lane of the app's React Native and Expo releases. This table is generated from the same numbers.",
  },
  {
    kind: "p",
    text: "Tested on the iOS simulator (Xcode 27) and the Android emulator, in the example apps, bare and Expo, which are on the prerelease lane. CI compiles Lucent's React Native code against each release of the window. Not yet on physical devices ([roadmap](/docs/releases/roadmap/)).",
  },
];

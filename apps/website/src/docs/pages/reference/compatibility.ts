import type { Block } from "../../types";
import { requirements } from "../../../generated/compatibility";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["", "Supported"],
    rows: [
      ["React Native", `${requirements.reactNative} or later, New Architecture`],
      ["Expo", `SDK ${requirements.expoSdk} or later, in a development build`],
      ["Node", `${requirements.node} or later`],
      ["JDK, for Android builds", `${requirements.jdk.min} to ${requirements.jdk.max}`],
      ["Android", `API ${requirements.minAndroidApi} and later; newer APIs need an \`available\` check`],
      ["iOS", "React Native's minimum iOS version"],
      ["Xcode, Android SDK and NDK", "the versions your React Native version needs"],
    ],
  },
  {
    kind: "p",
    text: "`lucent doctor` checks these on your machine, and this table is generated from the same numbers.",
  },
  {
    kind: "p",
    text: "Tested on the iOS simulator (Xcode 27) and the Android emulator, in the example apps, bare and Expo. Not yet on physical devices ([roadmap](/docs/status/)).",
  },
];

// The bare app's parity case, in place of the Expo app's original packages.
import { Platform } from "react-native";
import { linkedLibraries } from "../../sdk/linked.lucent";
import type { SdkCase } from "./types";

// Lucent binds what the app already links like the SDK: React Native's pods
// on iOS, AndroidX on Android (src/sdk/linked.lucent.ts).
export const parityCases: SdkCase[] = [
  {
    name: "linked libraries (React Native's pods; AndroidX)",
    run: linkedLibraries,
    expected:
      Platform.OS === "ios"
        ? /^\d+ request handlers, \d+ image decoders$/
        : "INTERNET granted true",
  },
];

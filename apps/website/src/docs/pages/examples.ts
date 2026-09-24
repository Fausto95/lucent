import type { Block } from "../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["Example", "Replaces", "What to look at"],
    rows: [
      [
        "[Clipboard](/docs/examples/clipboard/)",
        "`expo-clipboard`",
        "The smallest, to start with: one SDK class per platform.",
      ],
      [
        "[Location](/docs/examples/location/)",
        "`expo-location`",
        "A CoreLocation delegate, an Android listener, and updates sent to a JS callback.",
      ],
      [
        "[Network state](/docs/examples/netinfo/)",
        "`@react-native-community/netinfo`",
        "The Network framework's C API with a block; an Android class extended in Lucent.",
      ],
      [
        "[Local authentication](/docs/examples/local-authentication/)",
        "`expo-local-authentication`",
        "A completion handler awaited as a promise, and `NSError` out-parameters.",
      ],
      [
        "[Secure store](/docs/examples/secure-store/)",
        "`expo-secure-store`",
        "Keychain C functions, the Android Keystore, and a module shipped as a package.",
      ],
      [
        "[Haptics](/docs/examples/haptics/)",
        "`expo-haptics`",
        "Main-thread UIKit calls, and Android API-level checks.",
      ],
    ],
  },
  {
    kind: "p",
    text: "Each is one module for both platforms. They run in the repository's example apps, bare and Expo. On the iOS simulator and the Android emulator, they pass the same checks as the packages they replace.",
  },
  {
    kind: "p",
    text: "They haven't been tested on physical devices yet ([roadmap](/docs/roadmap/)).",
  },
];

import type { Block } from "../../types";
import { source } from "../../../generated/examples/secure-store";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: the Keychain's C functions (`SecItemAdd`, `SecItemCopyMatching`), with a query built as a `Record` and the result read through `Out<NSObject>`.",
      "Android: an AES/GCM key from the Android Keystore encrypts each value, stored in `SharedPreferences`.",
      "It ships as an npm package, `lucent-secure-store`: an app that installs it compiles the module with its own.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "secureStore.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import * as SecureStore from "lucent-secure-store";

await SecureStore.setItemAsync("token", "s3cret");
await SecureStore.getItemAsync("token"); // "s3cret"
await SecureStore.deleteItemAsync("token");`,
      },
    ],
  },
  {
    kind: "p",
    text: "Source: [examples/lucent-secure-store](https://github.com/Fausto95/lucent/tree/main/examples/lucent-secure-store).",
  },
];

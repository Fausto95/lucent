import type { Block } from "../../types";
import { source } from "../../../generated/examples/local-authentication";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: `await context.evaluatePolicy(policy, reason)`. The SDK's completion handler becomes a promise, under the name Swift gives its async form.",
      "iOS: `canEvaluatePolicy` reports why it can't with an `NSError` out-parameter, read through `Out<Error>`.",
      "Android: the platform's `BiometricManager` and `KeyguardManager`, with API-level checks.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "localAuthentication.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import * as LocalAuthentication from "./src/localAuthentication.lucent";

if (await LocalAuthentication.hasHardwareAsync()) {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock" });
  console.log(result.success);
}`,
      },
    ],
  },
  {
    kind: "note",
    tone: "warn",
    text: "Android has no biometric prompt yet: it needs the current activity, which `lucent:android` doesn't expose ([roadmap](/docs/roadmap/)).",
  },
  {
    kind: "p",
    text: "Source: [localAuthentication.lucent.ts](https://github.com/Fausto95/lucent/blob/main/scripts/example-app/src/sdk/localAuthentication.lucent.ts).",
  },
];

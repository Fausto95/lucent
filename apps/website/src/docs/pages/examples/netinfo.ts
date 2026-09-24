import type { Block } from "../../types";
import { source } from "../../../generated/examples/netinfo";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: the Network framework's C functions. The path monitor's update handler is a Lucent function passed as a block, called on the main queue.",
      "Android: `Watcher` extends `ConnectivityManager.NetworkCallback`, an SDK class, and overrides three of its methods.",
      "`addEventListener` sends each change to a JS callback and returns an id that `removeEventListener` takes back.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "netInfo.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import * as NetInfo from "./src/netInfo.lucent";

const state = await NetInfo.fetch();
console.log(state.type, state.isConnected);

const id = await NetInfo.addEventListener((next) => console.log(next.type));
await NetInfo.removeEventListener(id);`,
      },
    ],
  },
  {
    kind: "p",
    text: "Source: [netInfo.lucent.ts](https://github.com/Fausto95/lucent/blob/main/scripts/example-app/src/sdk/netInfo.lucent.ts).",
  },
];

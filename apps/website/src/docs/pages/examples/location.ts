import type { Block } from "../../types";
import { source } from "../../../generated/examples/location";

export const blocks: Block[] = [
  {
    kind: "list",
    items: [
      "iOS: `Updates` implements `CLLocationManagerDelegate`. The managers are made on the main thread with `main()`, since they deliver to the thread that made them.",
      "Android: a plain function is the `LocationListener`, and `removeUpdates` takes the same function back.",
      "`watchPositionAsync` sends each position to a JS callback until `stopWatching(id)`.",
      "Android's location permissions reach the app's manifest by themselves: the SDK marks `requestLocationUpdates` with them.",
    ],
  },
  {
    kind: "tabs",
    tabs: [
      { label: "module", filename: "location.lucent.ts", code: source },
      {
        label: "JS usage",
        filename: "App.tsx",
        code: `import * as Location from "./src/location.lucent";

const here = await Location.getCurrentPositionAsync();
console.log(here.coords.latitude, here.coords.longitude);

const id = await Location.watchPositionAsync((position) => {
  console.log(position.coords.latitude, position.coords.longitude);
});
await Location.stopWatching(id);`,
      },
    ],
  },
  {
    kind: "note",
    tone: "warn",
    text: "The port reads the permission but doesn't ask for it. Ask with `PermissionsAndroid` or `expo-location`, and add `NSLocationWhenInUseUsageDescription` to `Info.plist`.",
  },
  {
    kind: "p",
    text: "Android uses the platform's `LocationManager`, not Play services' fused provider. Generic Java interfaces such as `Consumer<Location>` aren't bound yet, so the module listens for one fix instead of calling `getCurrentLocation`. Source: [location.lucent.ts](https://github.com/Fausto95/lucent/blob/main/scripts/example-app/src/sdk/location.lucent.ts).",
  },
];

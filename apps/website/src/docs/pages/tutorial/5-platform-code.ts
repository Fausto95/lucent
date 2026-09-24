import type { Block } from "../../types";
import { diffs, files } from "../../../generated/tutorial/5-platform-code";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      { label: "location.lucent.ts", filename: "location.lucent.ts", cpp: true, code: files["src/location.lucent.ts"]! },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  {
    kind: "p",
    text: "One module holds both platforms. Inside `if (PLATFORM === \"ios\")`, the code uses CoreLocation; in the `else`, Android's `LocationManager`. Each platform's build compiles only its own branch.",
  },
  {
    kind: "list",
    items: [
      "`fromCLLocation` uses an iOS type, so it's iOS code and compiles only for iOS. `fromLocation` is Android code.",
      "`CLLocationManager` is main-thread only on iOS, so it's made inside `main()`. Its result, a `CLLocation`, comes back as a promise.",
      "Both branches turn SDK objects into a `Fix` before returning. SDK objects can't cross to JavaScript.",
      "`import type { Fix }` shares the type with the trip module.",
    ],
  },
  {
    kind: "p",
    text: "Android uses the platform's `LocationManager`, not Play services' fused provider, which the app doesn't include.",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "Rebuild the app. On a simulator or emulator with a location set, the screen adds where you are.",
  },
  {
    kind: "p",
    text: "Without a permission, iOS has no position to give, and Android throws a `java.lang.SecurityException` error, whose message the screen shows. Step 7 asks for the permission.",
  },
];

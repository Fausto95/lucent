import type { Block } from "../../types";
import { diffs, files } from "../../../generated/tutorial/7-permissions";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      { label: "location.lucent.ts", filename: "src/location.lucent.ts", diff: true, code: diffs["src/location.lucent.ts"]! },
      { label: "App.tsx", filename: "App.tsx", diff: true, code: diffs["App.tsx"]! },
    ],
  },
  { kind: "h2", text: "iOS" },
  {
    kind: "p",
    text: "`requestPermission` shows the system's prompt. iOS shows it only if the app says why it needs the location, in `Info.plist`:",
  },
  {
    kind: "panels",
    panels: [
      { label: "Expo", blocks: [{ kind: "code", filename: "app.json", code: files["app.json"]! }] },
      { label: "Bare React Native", blocks: [{ kind: "code", filename: "ios/<App>/Info.plist", code: files["Info.plist.xml"]! }] },
    ],
  },
  { kind: "h2", text: "Android" },
  {
    kind: "p",
    text: "There's nothing to add to the manifest. The SDK marks `requestLocationUpdates` with the location permissions it needs, and `lucent build` adds them to the native package's manifest, which Android merges into the app's.",
  },
  {
    kind: "p",
    text: "Asking at run time is still up to the app: `App.tsx` does it with `PermissionsAndroid`, before `watch`.",
  },
  { kind: "h2", text: "Run it" },
  {
    kind: "p",
    text: "Rebuild the app, since `Info.plist` changed. It asks for the location, then tracks the trip.",
  },
];

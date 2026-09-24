import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "Compare native and JavaScript" },
  {
    kind: "code",
    filename: "src/geo.bench.ts",
    code: `import { distance } from "./geo.lucent";

const paris = { latitude: 48.8584, longitude: 2.2945, time: 0 };
const louvre = { latitude: 48.8606, longitude: 2.3376, time: 0 };

export default {
  distance: () => distance(paris, louvre),
};`,
  },
  { kind: "code", filename: "terminal", code: "npx lucent bench" },
  {
    kind: "p",
    text: "`lucent bench` runs each case as your compiled module and as the same TypeScript run as JavaScript, and fails when the results differ. It needs a desktop Hermes, at `~/hermes` or in `HERMES_DIR`.",
  },
  { kind: "h2", text: "Test platform code's neighbors" },
  { kind: "code", filename: "terminal", code: "npx lucent build --platforms host --out .lucent/host" },
  {
    kind: "p",
    text: "A host build compiles for your computer. Platform code there throws `this code runs only on iOS and Android`, so the shared code around it can run in tests.",
  },
  { kind: "h2", text: "Run on devices" },
  {
    kind: "p",
    text: "SDK calls run only in the app. Build it for the simulator and the emulator, and check each platform's branch there.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "Jest or Vitest can't import `lucent:core` yet, so shared modules that use it can't run there as TypeScript ([roadmap](/docs/roadmap/)).",
  },
];

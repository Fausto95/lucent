import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "src/path.bench.ts",
    code: `import { pathLength, spiralLength } from "./path.lucent";

const points = Array.from({ length: 1000 }, (_, i) => ({ x: Math.cos(i / 10) * i, y: Math.sin(i / 10) * i }));

export default {
  objects: () => pathLength(points),
  native: () => spiralLength(1000),
};`,
  },
  { kind: "code", filename: "terminal", code: "npx lucent bench" },
  {
    kind: "code",
    filename: "terminal",
    copy: false,
    code: `CASE      JS         LUCENT     SPEEDUP
src/path.bench.ts
objects   54.0 µs    67.1 µs    0.8x
native    90.9 µs    7.9 µs     11.5x

per call, best of 5 rounds; desktop Hermes, so devices differ`,
  },
  {
    kind: "list",
    items: [
      "A `*.bench.ts` file next to your modules exports an object of cases: functions without arguments.",
      "Each case runs as your compiled module and as the same TypeScript run as JavaScript, in a desktop Hermes. The results must be equal.",
      "A speedup below 1x usually means the call copies more data than it computes on. [Design the boundary first](/docs/thinking/boundary-first/) explains why.",
      "Absolute times differ on devices; the comparison carries over. For numbers on a device, time the call in the app's release build.",
    ],
  },
];

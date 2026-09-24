import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "Run shared code as TypeScript" },
  {
    kind: "tabs",
    tabs: [
      {
        label: "Vitest",
        filename: "vitest.config.ts",
        code: `import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: { alias: { "lucent:core": require.resolve("@lucent-lang/lucent/core") } },
});`,
      },
      {
        label: "Jest",
        filename: "jest.config.js",
        code: `module.exports = {
  moduleNameMapper: { "^lucent:core$": "@lucent-lang/lucent/core" },
};`,
      },
    ],
  },
  {
    kind: "code",
    filename: "trip.test.ts",
    code: `import { expect, it } from "vitest";
import { Trip } from "./src/trip.lucent";

it("rejects a fix that arrives late", () => {
  const trip = new Trip();
  trip.add({ latitude: 48.85, longitude: 2.29, time: 1000 });
  expect(() => trip.add({ latitude: 48.86, longitude: 2.3, time: 0 })).toThrow(expect.objectContaining({ code: "E_OUT_OF_ORDER" }));
});`,
  },
  {
    kind: "p",
    text: "A module is TypeScript, so your test runner can run it as is. `@lucent-lang/lucent/core` is the JavaScript version of `lucent:core`, for `delay`, `error` and the rest. Modules with platform code can't run this way: their SDK calls need the app.",
  },
  { kind: "h2", text: "Compare native and JavaScript" },
  { kind: "code", filename: "terminal", code: "npx lucent bench" },
  {
    kind: "p",
    text: "`lucent bench` runs each case of your `*.bench.ts` files as the compiled module and as JavaScript, and fails when the results differ. It needs a desktop Hermes, at `~/hermes` or in `HERMES_DIR`.",
  },
  { kind: "h2", text: "Test platform code's neighbors" },
  {
    kind: "code",
    filename: "terminal",
    code: "npx lucent build --platforms host --out .lucent/host",
  },
  {
    kind: "p",
    text: "A host build compiles for your computer. Platform code there throws `this code runs only on iOS and Android`, so the shared code around it can run in tests.",
  },
  { kind: "h2", text: "Run on devices" },
  {
    kind: "p",
    text: "SDK calls run only in the app. Build it for the simulator and the emulator, and check each platform's branch there.",
  },
];

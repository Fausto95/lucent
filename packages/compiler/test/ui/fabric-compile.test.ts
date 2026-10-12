import fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  androidToolchain,
  compileErrors,
  iosToolchain,
  type Toolchain,
} from "./react-native-headers.ts";
import { writeFabricSources } from "./fabric-host.ts";

const platforms: [string, Toolchain | undefined][] = [
  ["the iOS simulator", iosToolchain()],
  ["Android", androidToolchain()],
];

describe("generated Fabric sources", () => {
  for (const [name, toolchain] of platforms)
    it.skipIf(!toolchain)(
      `compile against React Native's renderer headers for ${name}`,
      () => {
        const { dir, files } = writeFabricSources();

        expect(compileErrors(toolchain!, dir, files)).toBe("");

        fs.rmSync(dir, { recursive: true, force: true });
      },
      180_000,
    );
});

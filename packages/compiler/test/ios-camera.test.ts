/**
 * What a camera's frames need (lucent:ios): a serial queue for the
 * delegate, so frames arrive off the main thread, and a pixel buffer's
 * bytes. Typed from a schema set: the generated code is checked anywhere.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "Cam",
      header: "Cam/Cam.h",
      types: [
        {
          kind: "class",
          name: "CAMOutput",
          native: "CAMOutput",
          constructors: [{ params: [], selector: "init" }],
          methods: [
            {
              name: "setDelegate",
              selector: "setDelegate:queue:",
              params: [
                { name: "delegate", type: "Cam.CAMDelegate?" },
                { name: "queue", type: "id?" },
              ],
              returns: "void",
            },
          ],
        },
        {
          kind: "class",
          name: "CAMDelegate",
          native: "CAMDelegate",
          interface: true,
          methods: [
            {
              name: "output_didOutput",
              selector: "output:didOutput:",
              params: [
                { name: "output", type: "Cam.CAMOutput" },
                { name: "pixels", type: "id" },
              ],
              returns: "void",
              optional: true,
            },
          ],
        },
      ],
    },
  ]);

describe("camera frames", () => {
  it("arrive on a serial queue, and their pixel bytes are read under a lock", () => {
    const p = setProgram(
      `import { CAMOutput, type CAMDelegate } from "lucent:ios/Cam";
import { serialQueue, withPixelBytes, type NSObject } from "lucent:ios";
let brightest = 0;
class Frames implements CAMDelegate {
  output_didOutput(output: CAMOutput, pixels: NSObject): void {
    brightest = withPixelBytes(pixels, (bytes, bytesPerRow, width, height) => {
      let max = 0;
      for (let y = 0; y < height; y++) max = Math.max(max, bytes[y * bytesPerRow + width - 1] ?? 0);
      return max;
    });
  }
}
export async function run(): Promise<string> {
  new CAMOutput().setDelegate(new Frames(), serialQueue("camera.frames"));
  return \`\${brightest}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toContain('lucent::objc::serialQueue(LUCENT_STR("camera.frames"))');
    expect(p.mm).toContain("lucent::objc::withPixelBytes(");
    expect(p.mm).toContain("#include <lucent/platform/ios_pixels.h>");
    expect(p.r.frameworks ?? []).toContain("CoreVideo");
  });
});

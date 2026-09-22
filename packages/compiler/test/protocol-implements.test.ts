import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";

const protocolLibrary: LibraryModule = {
  schemaVersion: 1,
  source: `export type CaptureDelegate={};`,
  references: {
    CaptureDelegate: {
      nativeOnly: true,
      swift: "CaptureDelegate",
      kotlin: "CaptureDelegate",
      protocol: {
        methods: [
          {
            name: "onFrame",
            parameters: [{ name: "width", type: "number" }],
            result: "void",
          },
        ],
      },
    },
  },
};

test("accepts a class that implements a library protocol", () => {
  const result = compile(
    `import type {CaptureDelegate} from "@sdk/capture";
export class CameraDelegate implements CaptureDelegate {
  onFrame(width: number): void { width; }
}`,
    { fileName: "delegate.lucent.ts", libraries: { "@sdk/capture": protocolLibrary } },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});

test("rejects a class missing required protocol methods", () => {
  const result = compile(
    `import type {CaptureDelegate} from "@sdk/capture";
export class CameraDelegate implements CaptureDelegate {
  value: number = 0;
  constructor() {}
}`,
    { fileName: "missing.lucent.ts", libraries: { "@sdk/capture": protocolLibrary } },
  );
  expect(result.module).toBeNull();
  const message = result.diagnostics.map((d) => d.message + (d.help ?? "")).join("\n");
  expect(message).toContain("missing onFrame");
  expect(message).toContain("Candidates:");
  expect(message).toContain("onFrame(width: number): void");
});

test("rejects a class whose method types do not match the protocol", () => {
  const result = compile(
    `import type {CaptureDelegate} from "@sdk/capture";
export class CameraDelegate implements CaptureDelegate {
  onFrame(width: string): void { width; }
}`,
    { fileName: "mismatch.lucent.ts", libraries: { "@sdk/capture": protocolLibrary } },
  );
  expect(result.module).toBeNull();
  expect(result.diagnostics.some((d) => d.message.includes("does not match protocol"))).toBe(true);
});

import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { compile, renderDiagnostic, type LibraryModule } from "../src/index.ts";
import { expectGolden, FIXTURES, fixtureNames, readFixture } from "./golden.ts";

const DIR = join(FIXTURES, "conformance");

const bufLibrary: LibraryModule = {
  schemaVersion: 1,
  source: `export type Buffer = { length: number };
export declare function Buffer__create():Buffer;
export declare function Buffer__get_length(lucentSelf:Buffer):number;
export declare function Buffer__method_close(lucentSelf:Buffer):void;
export declare function borrow():Buffer;
export declare function take(buffer:Buffer):void;`,
  references: {
    Buffer: { swift: "Buf", kotlin: "Buf", contract: { ownership: "owned", executor: "caller", close: "close" } },
  },
  bindings: {
    Buffer__create: {
      contract: { symbolId: "buf.init", result: "owned", executor: "caller" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    Buffer__get_length: {
      contract: { symbolId: "buf.length", executor: "caller" },
      swift: ["return 1"],
      kotlin: ["return 1.0"],
    },
    Buffer__method_close: {
      contract: { symbolId: "buf.close", executor: "caller" },
      swift: ["lucentSelf.close()"],
      kotlin: ["lucentSelf.close()"],
    },
    borrow: {
      contract: { symbolId: "buf.borrow", result: "borrowed", executor: "caller" },
      swift: ["return Buf()"],
      kotlin: ["return Buf()"],
    },
    take: {
      contract: { symbolId: "buf.take", parameters: { buffer: { ownership: "retained" } }, executor: "caller" },
      swift: ["_ = buffer"],
      kotlin: ["buffer.hashCode()"],
    },
  },
};

const framesLibrary: LibraryModule = {
  source: `import type {NativeCallback} from '@lucent-lang/core/types';
export type Frame={width:number};
export declare function Frame__get_width(lucentSelf:Frame):number;
export declare function frames(callback:NativeCallback<(frame:Frame)=>number>):number;
export declare function retain(frame:Frame):void;`,
  references: {
    Frame: {
      nativeOnly: true,
      swift: "Frame",
      kotlin: "Frame",
      contract: { ownership: "external", executor: "caller" },
    },
  },
  bindings: {
    Frame__get_width: { swift: ["return lucentSelf.width"], kotlin: ["return lucentSelf.width"] },
    frames: { nativeOnly: true, swift: ["return try callback(Frame())"], kotlin: ["return callback(Frame())"] },
    retain: {
      nativeOnly: true,
      contract: { symbolId: "retain", parameters: { frame: { ownership: "retained" } } },
      swift: [],
      kotlin: [],
    },
  },
};

function librariesFor(name: string): Record<string, LibraryModule> | undefined {
  if (name.includes("borrow-callback") || name.includes("borrow-escape") || name.includes("borrow-retained"))
    return { "@sdk/frames": framesLibrary };
  if (name.includes("borrow") || name.includes("use-after-close") || name.includes("move"))
    return { "@lucent-lang/sdk/buf": bufLibrary };
  return undefined;
}

describe("conformance fixtures (semantics 0.1.0)", () => {
  for (const name of fixtureNames(DIR)) {
    const positive = name.startsWith("positive-");
    test(name, () => {
      const { source, fileName } = readFixture(name, DIR);
      const libraries = librariesFor(name);
      const result = compile(source, { fileName, ...(libraries ? { libraries } : {}) });
      if (positive) {
        expect(result.diagnostics).toEqual([]);
        expect(result.module).not.toBeNull();
        return;
      }
      expect(result.module).toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const rendered = result.diagnostics.map((d) => renderDiagnostic(d, source, fileName)).join("\n\n") + "\n";
      expectGolden(rendered, join(DIR, `${name}.diag.txt`));
    });
  }
});

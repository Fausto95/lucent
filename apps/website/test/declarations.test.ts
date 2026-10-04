import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { declarationsOf } from "../../../scripts/website/declarations.ts";

const lib = path.join(import.meta.dirname, "../../../packages/compiler/lib");

const SOURCE = `/**
 * The module, for contributors.
 *
 * @experimental
 */
import type { Other } from "lucent:other";

declare const hidden: unique symbol;

/**
 * Waits.
 *
 * Then resolves.
 *
 * \`\`\`ts
 * import { wait } from "lucent:demo";
 *
 * export async function f(): Promise<void> {
 *   await wait(1);
 * }
 * \`\`\`
 */
export declare function wait(ms: number): Promise<void>;

/** A handle. */
export declare class Handle {
  private readonly __lucent_Handle: never;
  /** Closes it. */
  close(): void;
  readonly open: boolean;
}

/** A Kotlin number. */
export type Float = number & { readonly "lucent:compose.Float"?: never };
`;

const PARAMS = `/**
 * Waits for a while.
 *
 * @param ms How long, in milliseconds.
 * @param signal Stops the wait early.
 */
export declare function wait(ms: number, signal?: AbortSignal): Promise<void>;
`;

describe("a function's parameters", () => {
  const [wait] = declarationsOf("params.d.ts", PARAMS).declarations;

  it("are read from its signature, with their @param text", () => {
    expect(wait!.params).toEqual([
      { name: "ms", type: "number", optional: false, doc: "How long, in milliseconds." },
      { name: "signal", type: "AbortSignal", optional: true, doc: "Stops the wait early." },
    ]);
  });

  it("leave the description's paragraphs", () => {
    expect(wait!.doc).toEqual(["Waits for a while."]);
  });
});

describe("declarationsOf", () => {
  const module = declarationsOf("demo.d.ts", SOURCE);

  it("lists the exported declarations, in order", () => {
    expect(module.declarations.map((d) => [d.name, d.kind])).toEqual([
      ["wait", "function"],
      ["Handle", "class"],
      ["Float", "type"],
    ]);
  });

  it("reads the module as experimental from its opening comment's @experimental", () => {
    expect(module.experimental).toBe(true);
  });

  it("takes each declaration's own comment as paragraphs, its code as examples", () => {
    const wait = module.declarations[0]!;

    expect(wait.doc).toEqual(["Waits.", "Then resolves."]);
    expect(wait.examples).toEqual([
      'import { wait } from "lucent:demo";\n\nexport async function f(): Promise<void> {\n  await wait(1);\n}',
    ]);
    expect(wait.signature).toBe("function wait(ms: number): Promise<void>;");
  });

  it("leaves brands out of signatures, and lists members with their comments", () => {
    const [, handle, float] = module.declarations;

    expect(handle!.signature).toBe(
      "class Handle {\n  close(): void;\n  readonly open: boolean;\n}",
    );
    expect(handle!.members).toEqual([
      { name: "close", signature: "close(): void;", doc: "Closes it." },
      { name: "open", signature: "readonly open: boolean;", doc: "" },
    ]);
    expect(float!.signature).toBe("type Float = number;");
  });

  it("fails on an exported declaration without a comment", () => {
    expect(() => declarationsOf("bare.d.ts", "export declare function bare(): void;\n")).toThrow(
      "bare.d.ts: bare has no doc comment",
    );
  });

  it("reads every lucent:* module and the globals", () => {
    const read = (file: string) =>
      declarationsOf(file, fs.readFileSync(path.join(lib, file), "utf8"));
    const names = (file: string) => read(file).declarations.map((d) => d.name);

    expect(names("sdk/core.d.ts")).toEqual(
      expect.arrayContaining(["delay", "fromCallback", "subscribe", "compute", "NativeBuffer"]),
    );
    expect(names("globals.d.ts")).toEqual(["Console", "AbortSignal", "AbortController"]);
    for (const file of ["platform", "thread", "ios", "android", "ui", "compose"])
      expect(read(`sdk/${file}.d.ts`).declarations.length).toBeGreaterThan(0);
    expect(read("sdk/ui.d.ts").experimental).toBe(true);
    expect(read("sdk/core.d.ts").experimental).toBe(false);
  });
});

/**
 * fromCallback and subscribe (lucent:core): what the e2e case cannot show
 * beside native code. The JavaScript implementation reports a throwing
 * cleanup to the host's uncaught error handler, and the compiler refuses
 * what has no native form.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { compile, coreJsPath } from "../src/index.ts";

type Cleanup = (() => void) | void;

type Core = {
  fromCallback<T>(
    register: (resolve: (value: T) => void, reject: (reason: Error) => void) => Cleanup,
    signal?: AbortSignal,
  ): Promise<T>;
  subscribe<T>(
    register: (next: (value: T) => void, end: () => void, fail: (error: Error) => void) => Cleanup,
    onValue: (value: T) => void,
    signal?: AbortSignal,
  ): Promise<void>;
};

const core = createRequire(import.meta.url)(coreJsPath()) as Core;

function compileSource(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-callbacks-"));
  const file = path.join(dir, "m.lucent.ts");
  fs.writeFileSync(file, source);
  return compile([file]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lucent:core's fromCallback in JavaScript", () => {
  it("reports a throwing cleanup as uncaught, and keeps the outcome", async () => {
    const uncaught: (() => void)[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((f: () => void) => {
      uncaught.push(f);
      return 0;
    }) as never);
    let resolve: (value: number) => void = () => {};

    const p = core.fromCallback<number>((res) => {
      resolve = res;
      return () => {
        throw new RangeError("cleanup");
      };
    });

    expect(resolve(1)).toBeUndefined();
    await expect(p).resolves.toBe(1);
    expect(uncaught).toHaveLength(1);
    expect(() => uncaught[0]!()).toThrow("cleanup");
  });

  it("never calls the registration with an aborted signal", async () => {
    const register = vi.fn<() => void>(() => {});
    const aborted = AbortSignal.abort(new RangeError("stop"));

    await expect(core.fromCallback(register, aborted)).rejects.toThrow("stop");
    // Aborting is how a subscription's caller ends it: it resolves.
    await expect(core.subscribe(register, () => {}, aborted)).resolves.toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it("stops listening to the signal once settled", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    await core.fromCallback<number>((resolve) => resolve(2), controller.signal);

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("compiling fromCallback and subscribe", () => {
  it("refuses a promise as the reported value, which JavaScript would adopt", () => {
    const r = compileSource(`import { fromCallback } from "lucent:core";
export function wrapped(p: Promise<number>): Promise<Promise<number>> {
  return fromCallback<Promise<number>>((resolve) => resolve(p));
}
`);

    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT1007",
        "a callback reports a value, not a promise: await the promise and report its value",
      ],
    ]);
  });
});

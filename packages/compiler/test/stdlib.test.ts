import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import type { LibraryModule } from "../src/index.ts";

/** Everything beyond byte primitives arrives as a package manifest, exactly as an app's own SDK bindings do. */
const TOOLKIT: Record<string, LibraryModule> = {
  "@lucent-lang/example-toolkit": {
    source: "export declare function sha256(bytes:Uint8Array):string;",
    bindings: {
      sha256: { capabilities: ["crypto"], cost: "cpu", swift: ['return ""'], kotlin: ['return ""'] },
    },
  },
};

test.each([
  ["export function f(text:string):Uint8Array{return encodeUTF8(text);}", "encodeUTF8"],
  ["export function f(bytes:Uint8Array):string{return decodeUTF8(bytes);}", "decodeUTF8"],
  ["export function f(bytes:Uint8Array):Uint8Array{return copyBytes(bytes);}", "copyBytes"],
] as const)("links the built-in byte primitive %#", (body, name) => {
  const r = compile(`import {${name}} from "@lucent-lang/core";${body}`, { fileName: "stdlib.lucent.ts" });
  expect(r.diagnostics).toEqual([]);
  expect(r.module?.capabilities ?? []).toEqual([]);
  expect(r.module?.functions.some((f) => f.binding)).toBe(true);
});

test("a package binding contributes its capability", () => {
  const r = compile(
    'import {sha256} from "@lucent-lang/example-toolkit"; export function f(bytes:Uint8Array):string{return sha256(bytes);}',
    { fileName: "hash.lucent.ts", libraries: TOOLKIT },
  );
  expect(r.diagnostics).toEqual([]);
  expect(r.module?.capabilities).toEqual(["crypto"]);
});

test("removed built-in libraries no longer resolve", () => {
  for (const library of ["crypto", "filesystem", "network", "device", "platform/clock", "platform/locale"]) {
    const r = compile(`import {anything} from "@lucent-lang/${library}"; export function f():number{return 1;}`, {
      fileName: "removed.lucent.ts",
    });
    expect(r.diagnostics.map((d) => d.code)).toContain("LC1006");
  }
});

test("warns when MainThread calls a CPU-intensive package binding", () => {
  const r = compile(
    'import {sha256} from "@lucent-lang/example-toolkit"; @MainThread export async function hash(bytes:Uint8Array):Promise<string>{return sha256(bytes);}',
    { fileName: "hash.lucent.ts", libraries: TOOLKIT },
  );
  expect(r.module).not.toBeNull();
  expect(r.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "LC3002", severity: "warning" })]),
  );
});

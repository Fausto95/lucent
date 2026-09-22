import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
test.each([
  ["core", "export function f(text:string):Uint8Array{return encodeUTF8(text);}", "encodeUTF8", []],
  ["core", "export function f(bytes:Uint8Array):string{return decodeUTF8(bytes);}", "decodeUTF8", []],
  [
    "filesystem",
    "export async function f(path:string):Promise<Uint8Array>{return await read(path);}",
    "read",
    ["filesystem"],
  ],
  [
    "filesystem",
    "export async function f(path:string,bytes:Uint8Array):Promise<void>{await write(path,bytes);}",
    "write",
    ["filesystem"],
  ],
  ["crypto", "export function f(bytes:Uint8Array):string{return sha256(bytes);}", "sha256", ["crypto"]],
  ["network", "export async function f(url:string):Promise<Uint8Array>{return await get(url);}", "get", ["network"]],
  ["device", "export async function f():Promise<string>{return await model();}", "model", ["device"]],
] as const)("links native %s library", (library, body, name, capabilities) => {
  const r = compile(`import {${name}} from "@lucent-lang/${library}";${body}`, { fileName: "stdlib.lucent.ts" });
  expect(r.diagnostics).toEqual([]);
  expect(r.module?.capabilities ?? []).toEqual(capabilities);
  expect(r.module?.functions.some((f) => f.binding)).toBe(true);
});
test("warns when MainThread calls a CPU-intensive native binding", () => {
  const r = compile(
    'import {sha256} from "@lucent-lang/crypto"; @MainThread export async function hash(bytes:Uint8Array):Promise<string>{return sha256(bytes);}',
    { fileName: "hash.lucent.ts" },
  );
  expect(r.module).not.toBeNull();
  expect(r.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "LC3002", severity: "warning" })]),
  );
});

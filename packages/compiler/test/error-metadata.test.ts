import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
test("lowers scalar error metadata without a serialized ABI value", () => {
  const result = compile(
    'export function fail(path:string):void{throw new LucentError("MISSING",{message:"Missing file",metadata:{path,attempt:1,retry:false,detail:null}});}',
    { fileName: "error.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.functions[0]?.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        op: "throw",
        metadata: expect.arrayContaining([expect.objectContaining({ name: "path" })]),
      }),
    ]),
  );
});
test.each(["{items:[1]}", "{nested:{value:1}}"])("rejects nonscalar error metadata %s", (metadata) => {
  expect(
    compile(`export function f():void{throw new LucentError("ERROR",{metadata:${metadata}});}`, {
      fileName: "error.lucent.ts",
    }).module,
  ).toBeNull();
});

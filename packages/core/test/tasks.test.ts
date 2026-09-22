import { expect, test } from "vite-plus/test";
import { compile } from "../../compiler/src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test("task scopes expose asynchronous close through both hosts", () => {
  const result = compile(
    `import {TaskScope, NativeTask} from '@lucent-lang/core/tasks';
export function create():TaskScope{return new TaskScope();}
export function begin(scope:TaskScope):NativeTask{return scope.begin();}
export async function close(scope:TaskScope):Promise<void>{await scope.close();}`,
    { fileName: "tasks.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const host of [expoHost, nitroHost])
    expect(host.emitProxy(result.module!).dts).toContain("close(): Promise<void>");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual([
    "Tasks.swift",
  ]);
});

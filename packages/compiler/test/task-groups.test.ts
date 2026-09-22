import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test("task groups compile begin/close through both hosts", () => {
  const result = compile(
    `import {TaskGroup, NativeTask} from '@lucent-lang/core/tasks';
export function create():TaskGroup{return new TaskGroup();}
export function begin(group:TaskGroup):NativeTask{return group.begin();}
export async function close(group:TaskGroup):Promise<void>{await group.close();}`,
    { fileName: "task-groups.lucent.ts" },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const host of [expoHost, nitroHost])
    expect(host.emitProxy(result.module!).dts).toContain("close(): Promise<void>");
  const swift = Object.values(result.module!.nativePackages ?? {})
    .flatMap((p) => Object.values(p.swift ?? {}))
    .join("\n");
  expect(swift).toContain("LucentTaskGroup");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toEqual([
    "Tasks.swift",
  ]);
});

import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../../compiler/src/index.ts";
import { classProxies } from "../src/objects.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
import { defineNativeClass, lucentCall, nativeObjectHandle, nativeObjectFromHandle } from "../../runtime/src/index.ts";

for (const [index, host] of [expoHost, nitroHost].entries())
  test(`${host.name} async methods retain references through result conversion`, async () => {
    const library: LibraryModule = {
      source:
        "export type Item={}; export declare function Item__create():Item; export declare function Item__method_copy(lucentSelf:Item, other:Item):Promise<Item>;",
      references: {
        Item: {
          swift: "NSString",
          kotlin: "java.lang.String",
          contract: { ownership: "owned", executor: "caller", transferable: true },
        },
      },
      bindings: {
        Item__create: { swift: ['return NSString(string: "")'], kotlin: ['return java.lang.String("")'] },
        Item__method_copy: { swift: ["return other"], kotlin: ["return other"] },
      },
    };
    const result = compile(
      `import {Item} from "@sdk/${host.name}"; export function create():Item{return new Item();}`,
      { fileName: "async-method.lucent.ts", libraries: { [`@sdk/${host.name}`]: library } },
    );
    expect(result.diagnostics).toEqual([]);
    const module = result.module!;
    const ctor = module.functions.find((f) => f.classOp?.kind === "constructor")!;
    const method = module.functions.find((f) => f.classOp?.member === "copy")!;
    const type = module.structs.find((s) => s.reference)!.name;
    expect(host.emitProxy(module).dts).toContain(`copy(other: ${type}): Promise<${type}>`);
    let next = 2000 + index * 10;
    const released: number[] = [];
    let complete!: (handle: number) => void;
    let fail!: (error: Error) => void;
    const native = {
      [ctor.name]: () => ++next,
      [method.name]: () =>
        new Promise<number>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        }),
      lucentRelease: (id: number) => released.push(id),
    };
    const Class = new Function(
      "native",
      "defineNativeClass",
      "lucentCall",
      "nativeObjectHandle",
      "nativeObjectFromHandle",
      classProxies(module, host.name === "expo") + `\nreturn ${type};`,
    )(native, defineNativeClass, lucentCall, nativeObjectHandle, nativeObjectFromHandle) as new () => {
      dispose(): void;
      copy(other: unknown): Promise<unknown>;
    };
    const receiver = new Class(),
      other = new Class();
    const receiverId = nativeObjectHandle(receiver, type),
      otherId = nativeObjectHandle(other, type);
    const pending = receiver.copy(other);
    receiver.dispose();
    other.dispose();
    expect(released).toEqual([]);
    complete(otherId);
    const returned = (await pending) as { dispose(): void };
    expect(nativeObjectHandle(returned, type)).toBe(otherId);
    expect(released).toEqual([receiverId]);
    returned.dispose();
    expect(released).toEqual([receiverId, otherId]);
    await expect(receiver.copy(returned)).rejects.toThrow("disposed");
    const failedReceiver = new Class(),
      failedArgument = new Class();
    const receiverHandle = nativeObjectHandle(failedReceiver, type),
      argumentHandle = nativeObjectHandle(failedArgument, type);
    const failed = failedReceiver.copy(failedArgument);
    failedReceiver.dispose();
    failedArgument.dispose();
    expect(released).toEqual([receiverId, otherId]);
    const rejected = expect(failed).rejects.toThrow("native failure");
    fail(new Error("native failure"));
    await rejected;
    expect(released).toEqual([receiverId, otherId, receiverHandle, argumentHandle]);
  });

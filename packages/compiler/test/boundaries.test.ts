import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
test("rejects unsupported event and shared object boundaries before code generation", () => {
  const sources = [
    'import {event} from "@lucent-lang/core/events"; export const e=event<Uint8Array>();',
    'import type {Event} from "@lucent-lang/core/events"; export function f(callback:Event<void>):void {}',
    "export class C { value:number[]=[]; }",
    "export class C {value:number=0;} export function f(c:C[]):number{return c.length;}",
    "export class C {value:number=0;} export async function f(c:C):Promise<number>{return c.value;}",
    "export declare function missing(): void;",
    "export type Empty = {};",
    'import type {Event} from "@lucent-lang/core/events"; export type Callbacks = {change:Event<void>};',
  ];
  for (const source of sources)
    expect(compile(source, { fileName: "invalid.lucent.ts" }).diagnostics.length, source).toBeGreaterThan(0);
});

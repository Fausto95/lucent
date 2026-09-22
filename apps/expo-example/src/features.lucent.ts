import type { Counter } from "./counter.lucent";
import { event } from "@lucent-lang/events";
import { abs, sqrt } from "@lucent-lang/core/math";
import { now } from "@lucent-lang/platform/clock";
export type Result = { kind: "ok"; value: number } | { kind: "error"; message: string };
export const progress = event<number>();
export function report(value: number): void {
  progress.emit(value);
}
export function advance(counter: Counter): number {
  return counter.increment(1);
}
export function evaluate(value: number): Result {
  if (value < 0) {
    return { kind: "error", message: "Negative" };
  }
  return { kind: "ok", value: sqrt(abs(value)) };
}
export function timestamp(): number {
  return now();
}
// @ts-expect-error Lucent function decorator; compiled before TypeScript.
@Background
export async function double(value: number): Promise<number> {
  return value * 2;
}

import {encodeUTF8,decodeUTF8,copyBytes} from "@lucent-lang/core";
import {sha256} from "@lucent-lang/crypto";
import {read,write,temporaryDirectory} from "@lucent-lang/filesystem";
import {get} from "@lucent-lang/network";
import {model} from "@lucent-lang/device";
import {Platform} from "@lucent-lang/platform";
export function nativeOS():string {return Platform.OS;}
export function bytes(text:string):Uint8Array {return copyBytes(encodeUTF8(text));}
export function hash(text:string):string {return sha256(encodeUTF8(text));}
export async function fileRoundTrip(text:string):Promise<string> {
 const directory=await temporaryDirectory();
 const path=directory+"/lucent-runtime-check.txt";
 await write(path,encodeUTF8(text));
 return decodeUTF8(await read(path));
}
export async function deviceModel():Promise<string> {return await model();}
export async function fetchBytes(url:string):Promise<Uint8Array> {return await get(url);}
export function metadataFailure(path:string):void {
 throw new LucentError("MISSING",{message:"File\n不存在 🌍",metadata:{path,attempt:1,retry:false,detail:null}});
}

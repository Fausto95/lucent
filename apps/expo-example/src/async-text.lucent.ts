import { NativeText } from "@lucent-lang/example-text";
export function createText(value: string): NativeText { return new NativeText(value); }
export async function textLength(value: NativeText): Promise<number> { return value.length; }

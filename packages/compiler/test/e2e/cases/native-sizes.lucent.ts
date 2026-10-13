import { NativeBuffer, type NativeSized } from "lucent:core";

/** Pixels of its own, which JavaScript's collector counts toward it. */
export class Image implements NativeSized {
  private pixels = NativeBuffer.allocate(0);

  get nativeSize(): number {
    return this.pixels.byteLength;
  }

  load(bytes: number): void {
    this.pixels.close();
    this.pixels = NativeBuffer.allocate(bytes);
  }

  clear(): void {
    this.pixels.close();
  }
}

/** A size it states as a field. */
export class Weights implements NativeSized {
  constructor(readonly nativeSize: number) {}
}

/** An image made and loaded in module code, before JavaScript sees it. */
export function image(bytes: number): Image {
  const i = new Image();
  i.load(bytes);
  return i;
}

export function buffer(bytes: number): NativeBuffer {
  return NativeBuffer.allocate(bytes);
}

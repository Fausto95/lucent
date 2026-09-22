import { Frame, frames } from "@sdk/frames";

/** Borrow stored into an array escapes its scope (semantics § exit negative #1). */
export function run(): number {
  return frames((frame: Frame): number => {
    const xs: Frame[] = [];
    xs.push(frame);
    return 0;
  });
}

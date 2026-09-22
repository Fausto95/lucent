import { Frame, frames, retain } from "@sdk/frames";

/** Borrow passed to a retained parameter (semantics § exit negative #1). */
export function run(): number {
  return frames((frame: Frame): number => {
    retain(frame);
    return 0;
  });
}

import { Frame, frames } from "@sdk/frames";

function widthOf(frame: Frame): number {
  return frame.width;
}

/** `retention: "call"` callback may read a borrowed parameter (semantics § exit #4). */
export function run(): number {
  return frames((frame: Frame): number => widthOf(frame));
}

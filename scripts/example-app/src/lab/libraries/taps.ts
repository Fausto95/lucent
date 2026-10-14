// The taps the Libraries screen's Gesture Handler detector heard, which a
// case reads.
let heard = 0;

/** The detector's callback. */
export function tapHeard(): void {
  heard += 1;
}

/** How many taps the detector heard. */
export function tapsHeard(): number {
  return heard;
}

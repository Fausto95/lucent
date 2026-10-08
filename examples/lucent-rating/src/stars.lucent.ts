// The rating's logic, shared by both platforms' files and testable as plain TypeScript.

/** The value a star shows: a whole number from 0 to max. */
export function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

/** `value` filled stars and the rest empty, as text: "★★★☆☆". */
export function stars(value: number, max: number): string {
  return "★".repeat(value) + "☆".repeat(Math.max(0, max - value));
}

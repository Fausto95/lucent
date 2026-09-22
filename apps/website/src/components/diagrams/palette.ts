/** Shared look for the hand-laid SVG diagrams. Matches the site palette so they read as part of the page. */
export const FONT = '"IBM Plex Mono", monospace';

export const palette = {
  boxFill: "#181e14",
  boxStroke: "#37412f",
  accentFill: "#1c2516",
  accent: "#c4f778",
  text: "#d5e4c7",
  muted: "#8d9783",
  laneFill: "#131712",
  laneStroke: "#262c22",
  line: "#6f7d64",
} as const;

export type Point = [number, number];

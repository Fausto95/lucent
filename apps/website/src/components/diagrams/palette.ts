import { tokens } from "../../styles/tokens.stylex";

/*
 * Shared look for the hand-laid SVG diagrams. Values are the site's CSS
 * variables, so the diagrams follow the theme. SVG presentation attributes
 * do not accept var(), hence the primitives set these through `style`.
 */
export const FONT = '"IBM Plex Mono", monospace';

export const palette = {
  boxFill: tokens.bgRaised,
  boxStroke: tokens.borderStrong,
  accentFill: tokens.surface,
  accent: tokens.accent,
  text: tokens.textCode,
  muted: tokens.textSubtle,
  laneFill: tokens.bgSunken,
  laneStroke: tokens.border,
  line: tokens.textSubtle,
} as const;

export type Point = [number, number];

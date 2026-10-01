/*
 * Shared look for the hand-laid SVG diagrams. Values are the theme's CSS
 * variables, so the diagrams follow light and dark. SVG presentation
 * attributes do not accept var(), hence the primitives set these through `style`.
 */
export const FONT = '"Geist Mono", monospace';

export const palette = {
  boxFill: "var(--sl-color-gray-6)",
  boxStroke: "var(--sl-color-gray-4)",
  accentFill: "var(--sl-color-accent-low)",
  accent: "var(--sl-color-accent-high)",
  text: "var(--sl-color-white)",
  muted: "var(--sl-color-gray-3)",
  laneFill: "var(--sl-color-black)",
  laneStroke: "var(--sl-color-gray-5)",
  line: "var(--sl-color-gray-3)",
} as const;

export type Point = [number, number];

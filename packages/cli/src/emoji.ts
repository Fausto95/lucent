/** Emoji first, plain fallback second. `--no-emoji` and NO_EMOJI pick the fallback. */
export const GLYPHS = {
  ok: ["✅", "✓"],
  fail: ["❌", "✗"],
  warn: ["⚠️", "!"],
  skip: ["⏭️", "-"],
  info: ["💡", "i"],
  next: ["👉", ">"],
  build: ["🔨", "#"],
  check: ["🔍", "?"],
  init: ["🌱", "+"],
  doctor: ["🩺", "~"],
  explain: ["📖", "@"],
  ir: ["🧬", "%"],
  clean: ["🧹", "x"],
  sdk: ["🧰", "&"],
  watch: ["👀", "~"],
  compile: ["⚙️", "*"],
  cached: ["📦", "="],
  sparkles: ["✨", "*"],
  rocket: ["🚀", ">"],
  pencil: ["📝", "~"],
  book: ["📚", "#"],
} as const satisfies Record<string, readonly [emoji: string, plain: string]>;

export type GlyphName = keyof typeof GLYPHS;

export const glyph = (name: GlyphName, emoji: boolean): string => GLYPHS[name][emoji ? 0 : 1];

export interface EmojiInput {
  env: Readonly<Record<string, string | undefined>>;
  /** An explicit --emoji / --no-emoji. */
  flag?: boolean;
}

export function supportsEmoji({ env, flag }: EmojiInput): boolean {
  if (flag !== undefined) return flag;
  return !env.NO_EMOJI;
}

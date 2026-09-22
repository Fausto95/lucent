import { expect, test } from "vite-plus/test";
import { GLYPHS, glyph } from "../src/emoji.ts";

test("every glyph has an emoji and a plain fallback", () => {
  for (const [name, [emoji, ascii]] of Object.entries(GLYPHS)) {
    expect(emoji, name).not.toBe("");
    expect(ascii, name).toMatch(/^[ -~─-⟿]+$/);
  }
});

test("glyph picks the emoji or the fallback", () => {
  expect(glyph("ok", true)).toBe("✅");
  expect(glyph("ok", false)).toBe("✓");
  expect(glyph("fail", false)).toBe("✗");
});

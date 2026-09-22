import { describe, expect, test } from "vite-plus/test";
import { blank, block, indent, render, sections } from "../src/doc.ts";

describe("render", () => {
  test("emits a line per string and ends with a newline", () => {
    expect(render(["one", "two"])).toBe("one\ntwo\n");
  });

  test("renders nothing for an empty sequence", () => {
    expect(render([])).toBe("");
  });

  test("indents a block body", () => {
    expect(render(block("func f() {", "return 1", "}"))).toBe("func f() {\n  return 1\n}\n");
  });

  test("indents nested blocks cumulatively", () => {
    expect(render(block("a {", block("b {", "c", "}"), "}"))).toBe("a {\n  b {\n    c\n  }\n}\n");
  });

  test("blank lines carry no trailing whitespace", () => {
    expect(render(block("a {", ["x", blank, "y"], "}"))).toBe("a {\n  x\n\n  y\n}\n");
  });
});

describe("multi-line fragments", () => {
  /**
   * The defect this replaces: a fragment built elsewhere was spliced in with a
   * hardcoded prefix, so its later lines sat at whatever depth the author
   * guessed. Re-anchoring makes the guess impossible.
   */
  test("re-anchors every line of a multi-line string at the current depth", () => {
    expect(render(block("outer {", "first\nsecond", "}"))).toBe("outer {\n  first\n  second\n}\n");
  });

  test("preserves relative indentation inside a multi-line string", () => {
    expect(render(block("outer {", "head {\n  nested\n}", "}"))).toBe(
      "outer {\n  head {\n    nested\n  }\n}\n",
    );
  });

  test("keeps interior blank lines blank rather than indenting them", () => {
    expect(render(block("outer {", "a\n\nb", "}"))).toBe("outer {\n  a\n\n  b\n}\n");
  });
});

describe("sections", () => {
  test("separates entries with exactly one blank line", () => {
    expect(render(sections(["a", "b", "c"]))).toBe("a\n\nb\n\nc\n");
  });

  test("adds no leading or trailing blank line", () => {
    expect(render(sections(["only"]))).toBe("only\n");
  });

  test("drops empty entries instead of emitting a stray gap", () => {
    expect(render(sections(["a", [], "b"]))).toBe("a\n\nb\n");
  });
});

describe("indent", () => {
  test("shifts a body one level without adding delimiters", () => {
    expect(render(indent(["a", "b"]))).toBe("  a\n  b\n");
  });

  test("honours a custom indent string", () => {
    expect(render(indent("a"), { indent: "\t" })).toBe("\ta\n");
  });
});

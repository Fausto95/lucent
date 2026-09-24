import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { detectTerminal, type Terminal } from "../src/cli/ui/terminal.ts";
import { createTheme } from "../src/cli/ui/theme.ts";
import { codeFrame, duration, link, table, visibleWidth } from "../src/cli/ui/format.ts";
import { renderDiagnostic } from "../src/cli/ui/diagnostic.ts";

const tty = { isTTY: true, columns: 120 };

describe("detectTerminal", () => {
  it("colours and animates an interactive terminal", () => {
    expect(detectTerminal({ TERM: "xterm-256color" }, tty, "darwin")).toMatchObject({
      color: true,
      interactive: true,
      unicode: true,
      width: 120,
    });
  });

  it("is plain on a pipe", () => {
    expect(detectTerminal({ TERM: "xterm-256color" }, { isTTY: false }, "darwin")).toMatchObject({
      color: false,
      interactive: false,
      width: 80,
    });
  });

  it("respects NO_COLOR, and FORCE_COLOR over a pipe", () => {
    expect(detectTerminal({ NO_COLOR: "1" }, tty, "darwin").color).toBe(false);
    expect(detectTerminal({ FORCE_COLOR: "1" }, { isTTY: false }, "darwin").color).toBe(true);
    expect(detectTerminal({ FORCE_COLOR: "0" }, tty, "darwin").color).toBe(false);
  });

  it("does not animate in CI", () => {
    expect(detectTerminal({ CI: "true" }, tty, "darwin")).toMatchObject({
      interactive: false,
      color: true,
    });
  });

  it("falls back to ASCII on a dumb terminal", () => {
    expect(detectTerminal({ TERM: "dumb" }, tty, "darwin")).toMatchObject({
      color: false,
      interactive: false,
      unicode: false,
    });
  });

  it("links only where the terminal renders OSC 8", () => {
    expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" }, tty, "darwin").links).toBe(true);
    expect(detectTerminal({ TERM_PROGRAM: "Apple_Terminal" }, tty, "darwin").links).toBe(false);
    expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" }, { isTTY: false }, "darwin").links).toBe(
      false,
    );
  });
});

const plain: Terminal = {
  color: false,
  unicode: true,
  interactive: false,
  links: false,
  width: 80,
};
const coloured: Terminal = { ...plain, color: true, interactive: true, width: 120 };

describe("theme", () => {
  it("colours tokens only when the terminal has colour", () => {
    expect(createTheme(plain).error("x")).toBe("x");
    expect(createTheme(coloured).error("x")).not.toBe("x");
    expect(visibleWidth(createTheme(coloured).error("x"))).toBe(1);
  });

  it("has ASCII symbols where Unicode is not safe", () => {
    expect(createTheme(plain).symbols.ok).toBe("✓");
    expect(createTheme({ ...plain, unicode: false }).symbols).toMatchObject({
      ok: "+",
      fail: "x",
      brand: "*",
    });
  });
});

describe("format", () => {
  it("writes durations as a person would", () => {
    expect([duration(41), duration(312), duration(1250), duration(65_000)]).toEqual([
      "41 ms",
      "312 ms",
      "1.3 s",
      "1 m 5 s",
    ]);
  });

  it("aligns tables by visible width, colours included", () => {
    const t = createTheme(coloured);
    expect(
      table([
        [t.bold("module"), "ios"],
        ["haptics", t.success("●")],
      ]).map((l) => stripVTControlCharacters(l)),
    ).toEqual(["module   ios", "haptics  ●"]);
  });

  it("links with OSC 8 only when the terminal supports it", () => {
    expect(link("docs", "https://x.dev", plain)).toBe("docs");
    expect(link("docs", "https://x.dev", { ...coloured, links: true })).toBe(
      "\x1b]8;;https://x.dev\x1b\\docs\x1b]8;;\x1b\\",
    );
  });

  const source =
    "export async function share(url: string) {\n  const app = UIApplication.shared;\n  return app;\n}\n";

  it("frames code with the line before and after, and underlines the span", () => {
    expect(
      codeFrame(source, { line: 2, column: 15, length: 20 }, createTheme(plain)),
    ).toMatchSnapshot();
  });

  it("frames code in colour", () => {
    expect(
      codeFrame(source, { line: 2, column: 15, length: 20 }, createTheme(coloured)),
    ).toMatchSnapshot();
  });

  it("fits code frames in 80 columns", () => {
    const long = `const x = ${"a".repeat(200)};\n`;
    const frame = codeFrame(long, { line: 1, column: 7, length: 1 }, createTheme(plain));
    for (const line of frame.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  });
});

describe("renderDiagnostic", () => {
  const source =
    "export async function share(url: string): Promise<string> {\n  const app = UIApplication.shared;\n  return url;\n}\n";
  const d = {
    code: "LUCENT3006",
    message: "UIApplication.shared is main-thread only",
    file: "share.ios.lucent.ts",
    line: 2,
    column: 15,
    length: 20,
    fix: "wrap the call in main(() => …)",
    docs: "https://lucent-lang.dev/docs/reference/diagnostics/#lucent3006",
  };
  for (const width of [80, 120]) {
    it(`renders code, message, frame, fix and docs at ${width} columns`, () => {
      expect(renderDiagnostic(d, source, createTheme({ ...plain, width }))).toMatchSnapshot(
        "plain",
      );
      expect(renderDiagnostic(d, source, createTheme({ ...coloured, width }))).toMatchSnapshot(
        "coloured",
      );
    });
  }

  it("renders a diagnostic without a location", () => {
    expect(
      renderDiagnostic(
        { code: "LUCENT9001", message: "TS6053: File not found" },
        undefined,
        createTheme(plain),
      ),
    ).toMatchSnapshot();
  });
});

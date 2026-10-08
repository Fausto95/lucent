import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

function project(sources: Record<string, string>, subdir = ""): string[] {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-macros-")), subdir);
  fs.mkdirSync(dir, { recursive: true });

  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src);
    return f;
  });
}

/** The lines of a generated file that undefine a name, include a header, or restore a name. */
function preprocessor(text: string): string[] {
  return text.split("\n").filter((l) => /^#(undef|include|pragma (push|pop)_macro)/.test(l));
}

describe("names shielded from macros", () => {
  it("covers names only a platform module's shared declaration declares", () => {
    const platform = `import type { Photo } from "./m.lucent.ts";
export function caption(p: Photo): string {
  return p.DOMAIN;
}
`;

    const r = compile(
      project({
        "m.lucent.ts":
          "export interface Photo { DOMAIN: string }\nexport declare function caption(p: Photo): string;\n",
        "m.ios.lucent.ts": platform,
        "m.android.lucent.ts": platform,
      }),
      { platforms: ["ios"] },
    );

    expect(r.diagnostics).toEqual([]);
    expect(preprocessor(r.files.get("ios/lucent_app_S_Photo.h")!)).toContain("#undef DOMAIN");
  });

  it("includes every header before undefining names", () => {
    const r = compile(
      project({
        "sizes.lucent.ts":
          "export interface Box { HUGE: number }\nexport function box(n: number): Box {\n  return { HUGE: n };\n}\n",
      }),
    );

    expect(r.diagnostics).toEqual([]);

    for (const [name, text] of r.files) {
      if (!/\.(h|cpp|mm)$/.test(name)) continue;

      const lines = preprocessor(text);
      const firstUndef = lines.findIndex((l) => l.startsWith("#undef"));
      const lastInclude = lines.findLastIndex((l) => l.startsWith("#include"));

      expect({ name, included: lastInclude < firstUndef || firstUndef < 0 }).toEqual({
        name,
        included: true,
      });
    }
  });

  it("does not depend on the directory the sources are in", () => {
    // `h` is declared in one module only; the other spells it only in its path.
    const sources = {
      "a.lucent.ts": "export function h(): number {\n  return 1;\n}\n",
      "b.lucent.ts": "export function k(): number {\n  return 2;\n}\n",
    };
    const generated = (subdir: string) => {
      const files = project(sources, subdir);
      const dir = path.dirname(files[0]!);
      const r = compile(files);

      expect(r.diagnostics).toEqual([]);

      return new Map([...r.files].map(([name, code]) => [name, code.split(dir).join("<dir>")]));
    };

    expect(generated("h")).toEqual(generated("plain"));
  });
});

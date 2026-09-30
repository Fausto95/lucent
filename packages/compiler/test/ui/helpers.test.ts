// lucent:ui, the helpers a component's setup uses: internal until views
// are public, so the module resolves only under LUCENT_VIEWS=fabric.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../../src/index.ts";
import { createLucentProgram } from "../../src/program.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");

/** Writes `files` into a package `@acme/app`; the Lucent files' paths. */
function app(files: Record<string, string>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ui-helpers-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return Object.keys(files).map((f) => path.join(dir, f));
}

const USES_UI = `import { effect } from "lucent:ui";

export function twice(n: number): number {
  return n * 2;
}

export type Effect = typeof effect;
`;

/** A label whose ref clears it (iOS, with the declaration every platform shares). */
export const CAPTION = {
  "caption.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";
import type { TextView } from "lucent:android/android.widget";

export declare function Caption(props: { text: string }): UILabel | TextView;
`,
  "caption.ios.lucent.tsx": `import { UILabel } from "lucent:ios/UIKit";
import { expose } from "lucent:ui";

export function Caption(props: { text: string }): UILabel {
  const label = new UILabel();

  expose({
    clear: () => {
      label.text = "";
    },
  });

  return label;
}
`,
};

describe("lucent:ui", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("does not resolve unless LUCENT_VIEWS is fabric", () => {
    const [file] = app({ "m.lucent.ts": USES_UI });

    expect(createLucentProgram([file!]).diagnostics.map((d) => d.message)).toEqual([
      "lucent:ui is not a Lucent module",
    ]);

    process.env.LUCENT_VIEWS = "fabric";

    expect(createLucentProgram([file!]).diagnostics).toEqual([]);
  });

  it("has no `native`: a setup, run once per mount, makes its views directly", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const [file] = app({
      "m.lucent.ts": `import { native } from "lucent:ui";

export type Native = typeof native;
`,
    });

    expect(createLucentProgram([file!]).diagnostics.map((d) => d.message)).toEqual([
      `TS2305: Module '"lucent:ui"' has no exported member 'native'.`,
    ]);
  });

  it.skipIf(!ios)(
    "gives a component the commands its setup exposes",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const r = compile(app(CAPTION), { platforms: ["ios"] });

      expect(r.diagnostics).toEqual([]);
      expect(r.components?.[0]?.commands).toEqual([
        { name: "clear", params: [], result: { kind: "enqueue" } },
      ]);
    },
    180_000,
  );
});
